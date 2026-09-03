import { answerProvider, type AnswerContext } from './answer.ts';
import { NO_ANSWER_REPLY, PROVIDER_ERROR_REPLY, isLeadComplete, quotesPrice, type LeadFields } from './answer-schema.ts';

/**
 * מסלול הלקוחות (סעיף 4.4). מוצא מ-wa-webhook כפונקציה עם db מוזרק,
 * כמו הנתב, כדי שבדיקה תריץ אותו מול מסד מזויף ותתעד כל כתיבה.
 *
 * הסדר:
 *   1. שיחה לפי טלפון. השתלטות אנושית → לוג בלבד, אין מענה.
 *   2. הקשר: מאגר פעיל, הגדרת המחירים, היסטוריה, ליד שנאסף.
 *   3. המודל.
 *   4. אין תשובה / שגיאה → הפניה + unanswered_questions + התראה.
 *   5. הרשמה: איסוף פרטים; כשהכול ידוע → תלמידה ממתינה + התראה.
 *
 * ★ שומר המחירים: גם אם המודל נקב מחיר, ההודעה לא יוצאת ככה כל עוד
 *   agent_may_quote_prices=false. זה נאכף בקוד, לא מוסכם בפרומפט.
 */

export type Db = { from: (t: string) => any };

export type CustomerDecision =
  | { route: 'customer_takeover'; phone: string }
  | { route: 'customer_answer'; phone: string; reply: string; faqQuestion: string | null }
  | { route: 'customer_no_answer'; phone: string; reply: string; unansweredId?: string }
  | { route: 'customer_lead'; phone: string; reply: string; lead: LeadFields; studentId: string | null; complete: boolean }
  | { route: 'customer_error'; phone: string; reply: string; reason: string };

export type CustomerDeps = {
  alert: (a: { kind: string; severity: 'info' | 'warning' | 'critical'; title: string; body?: string; meta?: unknown }) => Promise<void>;
  /** להזרקה בבדיקות; ברירת המחדל היא הספק לפי AI_DRY_RUN. */
  provider?: ReturnType<typeof answerProvider>;
};

const HISTORY_LIMIT = 10;

/** 0521234567 → 972521234567 */
function normalizeIl(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.startsWith('972')) return d;
  if (d.startsWith('0')) return `972${d.slice(1)}`;
  return d;
}

export async function answerCustomer(
  db: Db,
  deps: CustomerDeps,
  message: { phone: string; body: string },
): Promise<CustomerDecision> {
  const phone = message.phone;
  const text = message.body.trim();

  // ─── 1. השיחה ───
  const { data: conversation } = await db
    .from('conversations')
    .select('id, phone, contact_name, student_id, is_human_takeover, lead_state')
    .eq('phone', phone)
    .maybeSingle();

  if (conversation?.is_human_takeover) {
    console.log(`[customer] ${phone}: השתלטות אנושית — אין מענה אוטומטי`);
    return { route: 'customer_takeover', phone };
  }

  // ─── 2. ההקשר ───
  const [faqRes, settingRes, historyRes, branchesRes] = await Promise.all([
    db.from('faq_entries').select('id, question, answer').eq('is_active', true).order('created_at'),
    db.from('settings').select('value').eq('key', 'agent_may_quote_prices').maybeSingle(),
    db.from('wa_messages').select('direction, body').eq('phone', phone).order('created_at', { ascending: false }).limit(HISTORY_LIMIT + 1),
    db.from('branches').select('id, name, default_tuition').is('deleted_at', null),
  ]);
  const faq = (faqRes.data ?? []) as { id: string; question: string; answer: string }[];
  const mayQuotePrices = settingRes.data?.value === true || settingRes.data?.value === 'true';
  const branches = (branchesRes.data ?? []) as { id: string; name: string; default_tuition: number | string }[];
  // ההודעה הנוכחית כבר נרשמה כנכנסת — מסירים אותה מההיסטוריה.
  const history = ((historyRes.data ?? []) as { direction: 'in' | 'out'; body: string | null }[])
    .slice(1).reverse()
    .filter((m) => m.body)
    .map((m) => ({ role: m.direction === 'in' ? 'user' as const : 'assistant' as const, text: m.body as string }));
  const knownLead = (conversation?.lead_state ?? null) as LeadFields | null;

  const ctx: AnswerContext = {
    text, history, faq: faq.map((f) => ({ question: f.question, answer: f.answer })),
    branches: branches.map((b) => b.name), mayQuotePrices, lead: knownLead,
  };

  // ─── 3. המודל ───
  const outcome = await (deps.provider ?? answerProvider()).answer(ctx);

  // ─── 4א. המודל לא ענה / ענה זבל — הפניה, בלי המצאות ───
  if (!outcome.ok) {
    const { data: q } = await db.from('unanswered_questions')
      .insert({ phone, question: text }).select('id').maybeSingle();
    await deps.alert({
      kind: 'agent_error',
      severity: 'warning',
      title: 'סוכן הלקוחות לא הצליח לענות',
      body: `${phone}: "${text.slice(0, 140)}" — ${outcome.reason}: ${outcome.detail}`,
      meta: { phone, reason: outcome.reason },
    });
    return { route: 'customer_error', phone, reply: PROVIDER_ERROR_REPLY, reason: outcome.reason };
  }

  const answer = outcome.answer;

  // ─── 4ב. אין תשובה במאגר ───
  if (answer.kind === 'no_answer') {
    const { data: q } = await db.from('unanswered_questions')
      .insert({ phone, question: text }).select('id').maybeSingle();
    await deps.alert({
      kind: 'unanswered_question',
      severity: 'warning',
      title: 'שאלה מלקוחה שאין לה תשובה במאגר',
      body: `${phone}: "${text.slice(0, 200)}"`,
      meta: { phone, question: text },
    });
    return { route: 'customer_no_answer', phone, reply: NO_ANSWER_REPLY, unansweredId: q?.id };
  }

  // ─── ★ שומר המחירים ───
  let reply = answer.reply;
  if (!mayQuotePrices && quotesPrice(reply)) {
    const priceFaq = faq.find((f) => /מחיר|עולה|עלות/.test(f.question));
    reply = priceFaq?.answer ?? NO_ANSWER_REPLY;
    await deps.alert({
      kind: 'agent_price_blocked',
      severity: 'info',
      title: 'הסוכן ניסה לנקוב במחיר — ההודעה הוחלפה בהפניה',
      body: `${phone}: "${answer.reply.slice(0, 140)}"`,
      meta: { phone },
    });
  }

  // ─── 5. הרשמה ───
  if (answer.kind === 'lead') {
    const merged: LeadFields = {
      student_name: answer.lead?.student_name ?? knownLead?.student_name ?? null,
      age: answer.lead?.age ?? knownLead?.age ?? null,
      branch: answer.lead?.branch ?? knownLead?.branch ?? null,
      parent_name: answer.lead?.parent_name ?? knownLead?.parent_name ?? null,
      parent_phone: answer.lead?.parent_phone ?? knownLead?.parent_phone ?? phone,
    };
    const branch = merged.branch ? branches.find((b) => b.name === merged.branch) ?? null : null;
    if (merged.branch && !branch) merged.branch = null; // סניף שאינו קיים — לא ממציאים

    if (!isLeadComplete(merged) || !branch) {
      await db.from('conversations').update({ lead_state: merged }).eq('phone', phone);
      // חסר רק הסניף (או שהמודל המציא סניף): שואלים מבין הקיימים, לא סומכים על הניסוח שלו.
      const onlyBranchMissing = !branch && merged.student_name && merged.age && merged.parent_name && merged.parent_phone;
      const ask = onlyBranchMissing
        ? `תודה! באיזה סניף תרצי לרשום את ${merged.student_name}? האפשרויות: ${branches.map((b) => b.name).join(', ')}`
        : reply;
      return { route: 'customer_lead', phone, reply: ask, lead: merged, studentId: null, complete: false };
    }

    // כבר נוצרה תלמידה לשיחה הזו? לא יוצרים שנייה.
    if (conversation?.student_id) {
      return { route: 'customer_lead', phone, reply, lead: merged, studentId: conversation.student_id, complete: true };
    }

    const { data: season } = await db.from('seasons').select('id').eq('is_current', true).maybeSingle();
    const { data: student, error } = await db.from('students').insert({
      season_id: season?.id ?? null,
      branch_id: branch.id,
      full_name: merged.student_name,
      parent_name: merged.parent_name,
      parent_phone: normalizeIl(merged.parent_phone),
      status: 'pending',
      source: 'whatsapp',
      tuition_total: Number(branch.default_tuition ?? 0),
      notes: `גיל: ${merged.age}. נרשמה דרך סוכן הוואטסאפ.`,
    }).select('id').maybeSingle();

    if (error || !student) {
      await deps.alert({
        kind: 'agent_lead_failed', severity: 'warning',
        title: 'ליד מוואטסאפ לא נשמר',
        body: `${phone}: ${merged.student_name}, ${merged.branch} — ${error?.message ?? 'לא הוחזר מזהה'}`,
        meta: { phone, lead: merged },
      });
      return { route: 'customer_error', phone, reply: PROVIDER_ERROR_REPLY, reason: 'lead_insert_failed' };
    }

    await db.from('conversations').update({ student_id: student.id, lead_state: null, contact_name: merged.parent_name }).eq('phone', phone);
    await deps.alert({
      kind: 'new_lead', severity: 'info',
      title: `ליד חדש: ${merged.student_name}, ${merged.branch}`,
      body: `הורה: ${merged.parent_name} · ${merged.parent_phone} · גיל ${merged.age}. התלמידה נוצרה במצב "ממתינה".`,
      meta: { phone, student_id: student.id },
    });
    return { route: 'customer_lead', phone, reply, lead: merged, studentId: student.id, complete: true };
  }

  // ─── תשובה מהמאגר: מונה שימוש ───
  const hit = answer.faq_question ? faq.find((f) => f.question === answer.faq_question) : null;
  if (hit) {
    const { data: current } = await db.from('faq_entries').select('hits').eq('id', hit.id).maybeSingle();
    await db.from('faq_entries').update({ hits: Number(current?.hits ?? 0) + 1 }).eq('id', hit.id);
  }
  return { route: 'customer_answer', phone, reply, faqQuestion: hit?.question ?? null };
}
