import type { StandingProvider } from './standing.ts';

/**
 * ניסיון חיוב חוזר בהוראת קבע שהושבתה אחרי חיוב שנכשל (הבעלים). כאן ולא בתוך הפונקציה, כדי
 * שבדיקת הדפדפן תריץ בדיוק את הקוד הזה.
 *
 *  1. התוכנית — במסד, בהרשאות המשתמשת (rpc_standing_retry_preview: בעלים בלבד, וכל הכללים).
 *     ★ השלב (חיוב / חידוש) והתאריך הבא חייבים להיות מה שהבעלים ראתה — אחרת לא נוגעים.
 *  2. חיוב (stage 'charge'): SUMIT — ההוראה שלנו, ובמצב "הושבתה אחרי כישלון" (3). אחרת לא מחייבים
 *     (SUMIT אולי מנסה בעצמה). חיוב אחד על הכרטיס השמור של הלקוחה → נרשם במסד מיד, עבר או נדחה.
 *     נדחה — מחזירים את הסיבה; שום דבר אחר לא משתנה.
 *  3. חידוש (אחרי חיוב שעבר, או stage 'renew'): הוראה חדשה ב-SUMIT לחיובים שנותרו, מהתאריך בתוכנית.
 *     ★ נכשל — החיוב כבר נרשם; ההוראה מסומנת "צריך לחדש", והלחיצה הבאה רק מחדשת (בלי חיוב).
 */
type Res = { data: unknown; error: { message: string } | null };
type UserDb = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<Res> };
type AdminDb = UserDb & {
  from: (table: string) => any;   // eslint-disable-line @typescript-eslint/no-explicit-any
};

export type RetryPlan = {
  ok: true; stage: 'charge' | 'renew'; amount: number; missed: string | null; remaining_after: number;
  next: string | null; final: string | null; day: number; lines: string[];
};
export type RetryOutcome = { status: number; body:
  | { ok: true; charged: number; renewed: boolean; completed: boolean; next: string | null; remaining: number }
  | { ok: false; error: string; changed?: boolean; plan?: RetryPlan; declined?: boolean; charged?: number; uncertain?: boolean } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): RetryOutcome => ({ status, body: { ok: false, error, ...extra } });
const DISABLED_AFTER_FAILURE = 3;

export async function retryStanding(user: UserDb, admin: AdminDb, sumit: StandingProvider,
  input: { id?: unknown; stage?: unknown; next?: unknown }, by: string | null): Promise<RetryOutcome> {
  const id = String(input.id ?? '');
  const stage = String(input.stage ?? ''), expectedNext = input.next == null ? null : String(input.next);
  if (!UUID.test(id)) return fail(400, 'מזהה לא תקין');
  if (stage !== 'charge' && stage !== 'renew') return fail(400, 'חסר מה שהוצג לאישור');

  const preview = async () => {
    const { data, error } = await user.rpc('rpc_standing_retry_preview', { p_id: id });
    if (error) return { denied: error.message } as const;
    return { plan: data as RetryPlan | { ok: false; error: string } } as const;
  };
  const first = await preview();
  if ('denied' in first) return fail(403, first.denied ?? 'אין הרשאה');
  if (!first.plan.ok) return fail(409, first.plan.error);
  if (first.plan.stage !== stage || first.plan.next !== expectedNext) {
    return fail(409, 'המצב השתנה מאז שנפתח החלון — לבדוק ולאשר שוב.', { changed: true, plan: first.plan });
  }

  const { data: row } = await admin.from('standing_orders')
    .select('sumit_customer_id, sumit_recurring_id, amount, students(full_name), branches(name)').eq('id', id).maybeSingle();
  const o = row as { sumit_customer_id: number; sumit_recurring_id: number; amount: number;
    students: { full_name: string } | null; branches: { name: string } | null } | null;
  if (!o?.sumit_recurring_id) return fail(409, 'להוראה אין מזהה ב-SUMIT');
  const customerId = Number(o.sumit_customer_id);
  const who = o.students?.full_name ?? '', branch = o.branches?.name ?? '';

  let charged = 0;
  if (first.plan.stage === 'charge') {
    // ★ ההוראה שלנו, במצב "הושבתה אחרי כישלון". כל מצב אחר — SUMIT אולי מחייבת בעצמה; לא במקביל.
    let item;
    try { item = (await sumit.list(customerId)).find((i) => Number(i.ID) === Number(o.sumit_recurring_id)) ?? null; }
    catch (e) { return fail(502, `לא הצלחנו לבדוק את ההוראה מול SUMIT (${e instanceof Error ? e.message : 'שגיאה'}). לא חויב כלום.`); }
    if (!item) return fail(502, 'ההוראה לא נמצאה ב-SUMIT אצל הלקוחה הזו. לא חויב כלום.');
    if (Number(item.Status) !== DISABLED_AFTER_FAILURE) {
      return fail(409, `לפי SUMIT ההוראה לא במצב "הושבתה אחרי כישלון" (קוד ${item.Status ?? '—'}) — לא מחייבים במקביל. הסנכרון יעדכן את המצב.`);
    }
    const r = await sumit.chargeOnce({ customerId, amount: Number(first.plan.amount),
      itemName: `שכר לימוד — חיוב חוזר בהוראת קבע (${branch})`,
      description: `${who} · במקום החיוב של ${first.plan.missed ?? '—'} שנכשל` });
    if (!r.ok) {
      // ★ לא ידוע אם חויב — לא אומרים "לא חויב", ולא מזמינים לחיצה נוספת (חיוב כפול).
      if (r.uncertain) {
        await admin.rpc('rpc_standing_retry_uncertain', { p_id: id, p_error: r.error, p_by: by });
        await admin.from('system_alerts').insert({ kind: 'standing_retry_uncertain', severity: 'critical',
          title: 'חיוב חוזר בהוראת קבע — לא ברור אם חויב',
          body: `${who}: ${r.error}. לבדוק ב-SUMIT אם נוצר תשלום של ${first.plan.amount} ₪ לפני ניסיון נוסף.`,
          meta: { standing_order_id: id } });
        return fail(502, `לא ברור אם החיוב בוצע (${r.error}). לבדוק ב-SUMIT לפני ניסיון נוסף — נשלחה התראה, וניסיון נוסף ייחסם ל-24 שעות.`, { uncertain: true });
      }
      return fail(502, `SUMIT לא ביצעה את החיוב: ${r.error}. לא חויב כלום.`);
    }
    const p = r.payment;
    const { data: rec, error: recErr } = await admin.rpc('rpc_standing_retry_charged', {
      p_id: id, p_sumit_payment_id: Number(p.ID), p_amount: Number(p.Amount), p_at: p.Date ?? null,
      p_valid: p.ValidPayment === true, p_reason: p.StatusDescription ?? null, p_by: by });
    if (recErr || !(rec as { ok?: boolean } | null)?.ok) {
      await admin.from('system_alerts').insert({ kind: 'standing_retry_unrecorded', severity: 'critical',
        title: 'חיוב חוזר בהוראת קבע — SUMIT ענתה, אבל לא נרשם במערכת',
        body: `${who}: תשלום ${p.ID} על ${p.Amount} ₪ (${p.ValidPayment ? 'עבר' : 'נדחה'}). לא נרשם אצלנו — לבדוק ולרשום ידנית. לא ללחוץ שוב על "ניסיון חיוב חוזר".`,
        meta: { standing_order_id: id, sumit_payment_id: p.ID } });
      return fail(500, 'SUMIT ענתה, אבל הרישום אצלנו נכשל — נשלחה התראה. לא ללחוץ שוב לפני שבודקים.');
    }
    if (p.ValidPayment !== true) {
      const reason = (p.StatusDescription ?? '').trim();
      return fail(409, `חברת האשראי דחתה את החיוב${reason ? ` (${reason})` : ''}. שום דבר לא השתנה בהוראה — כדאי לבקש מההורה כרטיס אחר.`, { declined: true });
    }
    charged = Number(p.Amount);
    if (Number((rec as { remaining: number }).remaining) <= 0) {
      return { status: 200, body: { ok: true, charged, renewed: false, completed: true, next: null, remaining: 0 } };
    }
  }

  // ─── חידוש: הוראה חדשה לחיובים שנותרו ───
  const again = await preview();
  if ('denied' in again) return fail(403, again.denied ?? 'אין הרשאה');
  if (!again.plan.ok || again.plan.stage !== 'renew' || !again.plan.next) {
    return fail(500, again.plan.ok ? 'אחרי החיוב לא נמצאה תוכנית חידוש' : again.plan.error, { charged });
  }
  const plan = again.plan;
  const created = await sumit.create({ customerId, amount: Number(o.amount), installments: plan.remaining_after, dateStart: plan.next as string,
    itemName: `שכר לימוד — הוראת קבע (${branch})`,
    description: `${who} · ${plan.remaining_after} תשלומים חודשיים של ${o.amount} ₪ (חידוש אחרי חיוב שנכשל)` });
  if (!created.ok) {
    await admin.from('system_alerts').insert({ kind: 'standing_renew_failed', severity: 'critical',
      title: 'הוראת קבע לא חודשה ב-SUMIT',
      body: `${who}: ${charged ? `החיוב החוזר עבר (${charged} ₪) ונרשם, אבל ` : ''}יצירת ההוראה החדשה נכשלה: ${created.error}. ` +
            'בכרטיס ההוראה: "חידוש ההוראה" (בלי חיוב נוסף).',
      meta: { standing_order_id: id } });
    return fail(502, `${charged ? `החיוב עבר (${charged} ₪) ונרשם. ` : ''}חידוש ההוראה ב-SUMIT נכשל: ${created.error}. אפשר ללחוץ שוב "חידוש ההוראה" — בלי חיוב נוסף.`, { charged });
  }
  const { data: ren, error: renErr } = await admin.rpc('rpc_standing_retry_renewed', {
    p_id: id, p_recurring_id: created.recurringId, p_next: plan.next, p_remaining: plan.remaining_after, p_by: by });
  if (renErr || !(ren as { ok?: boolean } | null)?.ok) {
    await admin.from('system_alerts').insert({ kind: 'standing_renew_unrecorded', severity: 'critical',
      title: 'הוראת קבע חודשה ב-SUMIT, אבל לא נרשמה במערכת',
      body: `${who}: הוראה חדשה ${created.recurringId} נוצרה ב-SUMIT (${plan.remaining_after} חיובים מ-${plan.next}), אבל הרישום אצלנו נכשל. לא ללחוץ שוב — לבדוק.`,
      meta: { standing_order_id: id, sumit_recurring_id: created.recurringId } });
    return fail(500, 'ההוראה החדשה נוצרה ב-SUMIT, אבל הרישום אצלנו נכשל — נשלחה התראה. לא ללחוץ שוב.', { charged });
  }
  // ★ חויבה כבר ביצירה (לא אמור לקרות עם תאריך התחלה בחודש הבא) — נרשם, והבעלים יודעת.
  if (created.immediatePayment) {
    const ip = created.immediatePayment;
    await admin.rpc('rpc_record_standing_charge', { p_order: id, p_sumit_payment_id: Number(ip.ID), p_amount: Number(ip.Amount),
      p_charged_at: ip.Date, p_valid: ip.ValidPayment === true, p_document_url: null });
    await admin.from('system_alerts').insert({ kind: 'standing_order_immediate_charge', severity: 'warning',
      title: 'SUMIT חייבה את ההוראה המחודשת כבר ביצירה',
      body: `${who}: חיוב של ${ip.Amount} ₪ בוצע מיד ולא ב-${plan.next}. החיוב נרשם. לבדוק ב-SUMIT שמספר החיובים הנותרים נכון.`,
      meta: { standing_order_id: id, sumit_payment_id: ip.ID } });
  }
  return { status: 200, body: { ok: true, charged, renewed: true, completed: false, next: plan.next, remaining: plan.remaining_after } };
}
