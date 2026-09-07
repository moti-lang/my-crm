#!/usr/bin/env node
/**
 * סוכן הלקוחות — רץ **בלי מפתח Anthropic**, מול פלטים מוקלטים.
 *
 * הראיה בכל תרחיש היא מסד מזויף שמתעד כל כתיבה, וספק וואטסאפ מזויף
 * שמתעד כל שליחה. ארבע טענות מהאפיון (תנאי הקבלה של שלב 5):
 *   · שאלה שבמאגר נענית נכון.
 *   · שאלה שאינה במאגר לא מקבלת המצאה, נרשמת, ומייצרת התראה.
 *   · שיחת הרשמה יוצרת תלמידה בסטטוס ממתינה.
 *   · הסוכן אינו נוקב במחיר כל עוד agent_may_quote_prices=false — גם דרך המידע החופשי.
 *   · מידע על החוג: המאגר גובר; תשובה חופשית רק מעוגנת בקטע קיים, בלי הבטחות.
 * ובנוסף: השתלטות אנושית משתיקה, פלט פגום לא מגיע להורה, וכל תשובה
 * באמת נשלחת.
 *
 * הרצה:  npm run test:agent
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codeOf } from './_code.mjs';

process.env.AI_DRY_RUN = 'true';
process.env.WA_DRY_RUN = 'true';

const dir = mkdtempSync(join(tmpdir(), 'agent-'));
const bundle = (src, name) => {
  const out = join(dir, name);
  execFileSync('npx', ['esbuild', src, '--bundle', '--format=esm', `--outfile=${out}`,
    '--log-level=error', '--define:Deno.env.get=__denoEnvGet',
    '--banner:js=const __denoEnvGet = (k) => process.env[k];'], { stdio: 'inherit' });
  return out;
};
const { answerCustomer } = await import(bundle('supabase/functions/_shared/customer.ts', 'customer.mjs'));
const { deliverReply } = await import(bundle('supabase/functions/_shared/reply.ts', 'reply.mjs'));
const { NO_ANSWER_REPLY, PROVIDER_ERROR_REPLY, quotesPrice, promisesPlaceOrDiscount, validateAnswer } =
  await import(bundle('supabase/functions/_shared/answer-schema.ts', 'schema.mjs'));

let fails = 0;
const check = (label, ok, detail = '') => {
  if (!ok) fails++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
};

// ─────────────────── מסד מזויף שמתעד כל פעולה ───────────────────
const WRITE_OPS = ['insert', 'update', 'upsert', 'delete'];
function makeDb(rows) {
  const writes = [];
  const build = (table) => {
    const chain = {};
    let pending = null;
    for (const op of ['select', 'eq', 'is', 'gte', 'lte', 'order', 'limit', 'contains']) chain[op] = () => chain;
    chain.maybeSingle = async () => ({ data: pending?.op === 'insert' ? { id: `new-${table}`, ...(rows[table]?.insertReturns ?? {}) } : (rows[table]?.single ?? null), error: rows[table]?.insertError && pending?.op === 'insert' ? { message: rows[table].insertError } : null });
    chain.then = (resolve) => resolve({ data: rows[table]?.list ?? [], error: null });
    for (const op of WRITE_OPS) {
      chain[op] = (payload) => { pending = { op, payload }; writes.push({ table, op, payload }); return chain; };
    }
    return chain;
  };
  return { db: { from: build }, writes };
}
function makeAlerts() { const alerts = []; return { alerts, alert: async (a) => { alerts.push(a); } }; }
function makeWa() { const sent = []; return { sent, wa: { sendText: async (to, body, key) => { sent.push({ to, body, key }); return { ok: true, providerMsgId: 'x', dryRun: true }; } } }; }

const FAQ = { list: [
  { id: 'faq-branches', question: 'באילו סניפים החוג פועל?', answer: 'החוג פועל בביתר עילית, מודיעין עילית, ירושלים רמות, בית שמש ואשדוד.' },
  { id: 'faq-price', question: 'כמה עולה החוג?', answer: 'המחירים משתנים לפי סניף ומספר התשלומים. אשמח להעביר אותך להניה שתיתן לך את כל הפרטים 🙏' },
] };
const KNOWLEDGE = { list: [
  { title: 'הצוות', body: 'את החוג מלמדת הניה טייכטל בעצמה, עם צוות מדריכות מנוסות.' },
  { title: 'מה קורה בשיעור', body: 'חימום, משחקי תיאטרון, עבודה על מונולוג, ובסוף השנה הפקה.' },
] };
const BRANCHES = { list: [{ id: 'b-beitar', name: 'ביתר עילית', default_tuition: 2000 }, { id: 'b-modiin', name: 'מודיעין עילית', default_tuition: 2000 }] };
const SEASON = { single: { id: 'season-1' } };
const PHONE = '972529990001';
const base = (extra = {}) => ({
  conversations: { single: { id: 'c1', phone: PHONE, is_human_takeover: false, student_id: null, lead_state: null } },
  faq_entries: FAQ, knowledge_sections: KNOWLEDGE, branches: BRANCHES, seasons: SEASON,
  settings: { single: { value: false } },
  wa_messages: { list: [{ direction: 'in', body: 'x' }] },
  ...extra,
});

async function run(text, rows = base()) {
  const { db, writes } = makeDb(rows);
  const { alerts, alert } = makeAlerts();
  const decision = await answerCustomer(db, { alert }, { phone: PHONE, body: text });
  const { sent, wa } = makeWa();
  const delivery = await deliverReply(db, wa, PHONE, decision, 'reply:test');
  return { decision, writes, alerts, sent, delivery };
}
const writesTo = (writes, table, op) => writes.filter((w) => w.table === table && (!op || w.op === op));

// ═══════ 1. שאלה שבמאגר ═══════
console.log('\nשאלה שבמאגר:');
{
  const r = await run('באילו סניפים החוג פועל?');
  check('★ נענית מהמאגר', r.decision.route === 'customer_answer', r.decision.route);
  check('התשובה מזכירה סניפים מהמאגר', /ביתר עילית/.test(r.decision.reply));
  check('★ מונה השימוש של השאלה עולה', writesTo(r.writes, 'faq_entries', 'update').length === 1
        && writesTo(r.writes, 'faq_entries', 'update')[0].payload.hits === 1);
  check('לא נרשמה שאלה ללא מענה', writesTo(r.writes, 'unanswered_questions').length === 0);
  check('לא נוצרה תלמידה', writesTo(r.writes, 'students').length === 0);
  check('אין התראה', r.alerts.length === 0);
  check('★ התשובה נשלחה בוואטסאפ', r.sent.length === 1 && r.sent[0].body === r.decision.reply);
}

// ═══════ 2. שאלה שאינה במאגר ═══════
console.log('\nשאלה שאינה במאגר:');
{
  const r = await run('יש חוג גם לבנים?');
  check('★ אין המצאה — המשפט הקבוע מחוק 2, מילה במילה', r.decision.reply === NO_ANSWER_REPLY, r.decision.reply);
  const q = writesTo(r.writes, 'unanswered_questions', 'insert');
  check('★ נרשמה ב-unanswered_questions עם הטלפון והשאלה', q.length === 1 && q[0].payload.phone === PHONE && q[0].payload.question === 'יש חוג גם לבנים?');
  check('★ התראה מיידית לבעלים עם השאלה והטלפון',
        r.alerts.length === 1 && r.alerts[0].kind === 'unanswered_question' && r.alerts[0].body.includes(PHONE) && r.alerts[0].body.includes('לבנים'));
  check('לא נוצרה תלמידה ולא נגעו במאגר', writesTo(r.writes, 'students').length === 0 && writesTo(r.writes, 'faq_entries').length === 0);
  check('★ ההפניה נשלחה להורה', r.sent.length === 1 && r.sent[0].body === NO_ANSWER_REPLY);
}
{
  const r = await run('שאלה שאף אחד לא הקליט לה פלט');
  check('טקסט לא מוכר → אין תשובה (לא "מצליח" בטעות)', r.decision.route === 'customer_no_answer');
}

// ═══════ 3. שומר המחירים ═══════
console.log('\nשומר המחירים:');
{
  const r = await run('__FIXTURE_QUOTES_PRICE__');
  check('★ agent_may_quote_prices=false: המחיר לא יוצא', !quotesPrice(r.decision.reply), r.decision.reply);
  check('במקומו — תשובת המחיר מהמאגר (הפניה להניה)', /להניה/.test(r.decision.reply));
  check('הבעלים מקבלת התראה שהמודל ניסה', r.alerts.some((a) => a.kind === 'agent_price_blocked'));
  check('מה שנשלח הוא ההפניה, לא המחיר', r.sent.length === 1 && !quotesPrice(r.sent[0].body));
}
{
  const r = await run('__FIXTURE_KNOWLEDGE_PRICE__', base({ settings: { single: { value: true } } }));
  check('agent_may_quote_prices=true: מחיר מתוך המידע על החוג עובר', quotesPrice(r.decision.reply), r.decision.reply);
  check('ובלי התראה', r.alerts.length === 0, JSON.stringify(r.alerts));
}
{
  const r = await run('__FIXTURE_QUOTES_PRICE__', base({ settings: { single: { value: true } } }));
  check('שאלת מחיר שיש לה תשובה במאגר: המאגר גובר גם כשהמתג דולק (התשובה של הניה, מילה במילה)', r.decision.reply === FAQ.list[1].answer);
}
{
  const r = await run('__FIXTURE_LEAD_PRICE__');
  check('★ גם בשיחת הרשמה — מחיר לא יוצא כשהמתג כבוי', !quotesPrice(r.decision.reply) && !quotesPrice(r.sent[0]?.body ?? ''), r.decision.reply);
  check('ההרשמה עצמה ממשיכה (הליד נשמר)', r.decision.route === 'customer_lead');
}
check('quotesPrice מזהה ₪, ש״ח ושקלים', quotesPrice('2,000 ש״ח') && quotesPrice('₪1800') && quotesPrice('150 שקל'));
check('quotesPrice לא נבהל ממספר סתמי', !quotesPrice('בת 10, כיתה ה') && !quotesPrice('בשעה 17:00'));

// ═══════ 3ב. מידע על החוג ═══════
console.log('\nמידע על החוג:');
{
  const r = await run('מי מלמדת בחוג?');
  check('★ שאלה שאינה במאגר אבל במידע על החוג — נענית', r.decision.route === 'customer_answer' && /הניה טייכטל/.test(r.decision.reply), r.decision.reply);
  check('★ מסומנת כתשובה מהמידע, עם כותרת הקטע', r.decision.source === 'knowledge' && r.decision.knowledgeTitle === 'הצוות');
  check('לא נגעו במונה המאגר, לא נרשמה שאלה ללא מענה', writesTo(r.writes, 'faq_entries').length === 0 && writesTo(r.writes, 'unanswered_questions').length === 0);
  check('אין התראה', r.alerts.length === 0);
}
{
  const r = await run('מי מלמדת בחוג?', base({ knowledge_sections: { list: [] } }));
  check('★ אותה תשובה בלי מידע על החוג — אין מקור → המשפט הקבוע והעברה', r.decision.reply === NO_ANSWER_REPLY && r.decision.route === 'customer_no_answer');
  check('נרשמה כשאלה ללא מענה', writesTo(r.writes, 'unanswered_questions', 'insert').length === 1);
}
{
  const r = await run('__FIXTURE_KNOWLEDGE_UNGROUNDED__');
  check('★ "מהמידע" עם כותרת שלא קיימת — המצאה, לא יוצאת', r.decision.reply === NO_ANSWER_REPLY && !/חיפה/.test(r.sent[0]?.body ?? ''));
  check('התראה לבעלים על תשובה בלי מקור', r.alerts.some((a) => a.kind === 'agent_ungrounded'));
}
{
  const r = await run('__FIXTURE_KNOWLEDGE_PRICE__');
  check('★ מחיר דרך המידע החופשי, המתג כבוי — לא יוצא', !quotesPrice(r.decision.reply) && !quotesPrice(r.sent[0]?.body ?? ''), r.decision.reply);
  check('במקומו תשובת המחיר מהמאגר', r.decision.reply === FAQ.list[1].answer);
  check('והתראה', r.alerts.some((a) => a.kind === 'agent_price_blocked'));
}
{
  const r = await run('__FIXTURE_KNOWLEDGE_PROMISE__');
  check('★ הבטחת מקום/הנחה מתוך המידע — לא יוצאת', r.decision.reply === NO_ANSWER_REPLY && !/שמרתי|הנחה/.test(r.sent[0]?.body ?? ''));
  check('התראה לבעלים', r.alerts.some((a) => a.kind === 'agent_promise_blocked'));
}
{
  const r = await run('__FIXTURE_FAQ_REPHRASED__');
  check('★ יש שאלה תואמת במאגר — המאגר גובר: התשובה של הניה מילה במילה, לא הניסוח של המודל', r.decision.reply === FAQ.list[0].answer && !/חיפה/.test(r.decision.reply));
  check('מסומנת כתשובה מהמאגר', r.decision.source === 'faq' && r.decision.faqQuestion === FAQ.list[0].question);
  check('מונה השימוש עולה', writesTo(r.writes, 'faq_entries', 'update').length === 1);
}
check('promisesPlaceOrDiscount מזהה הבטחות', promisesPlaceOrDiscount('שמרתי לך מקום') && promisesPlaceOrDiscount('יש הנחה לאחיות') && promisesPlaceOrDiscount('מקום מובטח'));
check('promisesPlaceOrDiscount לא נבהל מ"מקום" סתמי', !promisesPlaceOrDiscount('החוג מתקיים במקום נעים') && !promisesPlaceOrDiscount('הניה תחזור אלייך'));

// ═══════ 4. שיחת הרשמה ═══════
console.log('\nשיחת הרשמה:');
{
  const r = await run('אני רוצה לרשום את הבת שלי');
  check('★ זוהתה כוונת הרשמה', r.decision.route === 'customer_lead' && r.decision.complete === false);
  check('שואל שאלה אחת (שם הבת)', /איך קוראים/.test(r.decision.reply));
  check('★ עדיין לא נוצרה תלמידה', writesTo(r.writes, 'students').length === 0);
  check('מה שנאסף נשמר בשיחה, לא בזיכרון', writesTo(r.writes, 'conversations', 'update').some((w) => 'lead_state' in w.payload));
  check('אין התראה בשלב האיסוף', r.alerts.length === 0);
}
{
  const r = await run('קוראים לה שירה, היא בת 10, בביתר עילית, אני רחל 0521234567');
  const s = writesTo(r.writes, 'students', 'insert');
  check('★ כשהכול ידוע — נוצרת תלמידה', s.length === 1);
  const p = s[0]?.payload ?? {};
  check('★ במצב ממתינה, מקור וואטסאפ', p.status === 'pending' && p.source === 'whatsapp');
  check('★ שכר הלימוד הוא ברירת המחדל של הסניף', p.tuition_total === 2000 && p.branch_id === 'b-beitar');
  check('הטלפון מנורמל ל-972', p.parent_phone === '972521234567');
  check('העונה הנוכחית', p.season_id === 'season-1');
  check('★ השיחה מקושרת לתלמידה', writesTo(r.writes, 'conversations', 'update').some((w) => w.payload.student_id === 'new-students'));
  check('★ התראה לבעלים: ליד חדש עם שם וסניף', r.alerts.some((a) => a.kind === 'new_lead' && /שירה/.test(a.title) && /ביתר עילית/.test(a.title)));
  check('אישור נשלח להורה', r.sent.length === 1);
}
{
  const r = await run('__FIXTURE_LEAD_PARTIAL_WITH_BRANCH__');
  check('★ ליד חלקי עם סניף אבל בלי פרטי הורה — עדיין לא נוצרת תלמידה', writesTo(r.writes, 'students').length === 0);
  check('ממשיך לשאול את הפרט הבא', /בת כמה/.test(r.decision.reply));
  check('הסניף שנאסף נשמר לשיחה', writesTo(r.writes, 'conversations', 'update').some((w) => w.payload.lead_state?.branch === 'ביתר עילית'));
}
{
  const r = await run('__FIXTURE_LEAD_MISSING_BRANCH__');
  check('★ ליד "שלם" לפי המודל אבל בלי סניף — לא נוצרת תלמידה', writesTo(r.writes, 'students').length === 0);
  check('ההורה נשאלת איזה סניף, עם הרשימה', /איזה סניף/.test(r.decision.reply) && /ביתר עילית/.test(r.decision.reply));
}
{
  const r = await run('__FIXTURE_LEAD_UNKNOWN_BRANCH__');
  check('★ סניף שאינו קיים ("חיפה") — לא ממציאים סניף, לא נוצרת תלמידה', writesTo(r.writes, 'students').length === 0);
  check('ההורה נשאלת מבין הסניפים הקיימים', /איזה סניף/.test(r.decision.reply) && !/חיפה/.test(r.decision.reply));
}
{
  const r = await run('קוראים לה שירה, היא בת 10, בביתר עילית, אני רחל 0521234567',
    base({ conversations: { single: { id: 'c1', phone: PHONE, is_human_takeover: false, student_id: 'existing', lead_state: null } } }));
  check('שיחה שכבר יצרה תלמידה — לא נוצרת שנייה', writesTo(r.writes, 'students').length === 0);
}
{
  const r = await run('קוראים לה שירה, היא בת 10, בביתר עילית, אני רחל 0521234567',
    base({ students: { insertError: 'boom' } }));
  check('כשל בשמירת הליד — התראה ולא שקט', r.alerts.some((a) => a.kind === 'agent_lead_failed'));
  check('ההורה מקבלת הפניה, לא שגיאה טכנית', r.decision.reply === PROVIDER_ERROR_REPLY);
}

// ═══════ 5. השתלטות אנושית ═══════
console.log('\nהשתלטות אנושית:');
{
  const r = await run('באילו סניפים החוג פועל?',
    base({ conversations: { single: { id: 'c1', phone: PHONE, is_human_takeover: true, student_id: null, lead_state: null } } }));
  check('★ אין מענה אוטומטי', r.decision.route === 'customer_takeover' && r.delivery.delivered === false);
  check('★ אפס כתיבות', r.writes.length === 0, JSON.stringify(r.writes));
  check('אין התראה', r.alerts.length === 0);
}

// ═══════ 6. המודל נופל ═══════
console.log('\nהמודל לא עונה:');
{
  const r = await run('__FIXTURE_TIMEOUT__');
  check('★ תלייה — ההורה לא נשארת בלי מילה', r.decision.reply === PROVIDER_ERROR_REPLY && r.sent.length === 1);
  check('נרשמת כשאלה ללא מענה', writesTo(r.writes, 'unanswered_questions', 'insert').length === 1);
  check('התראה לבעלים על כשל הסוכן', r.alerts.some((a) => a.kind === 'agent_error'));
}
for (const f of ['__FIXTURE_MALFORMED_JSON__', '__FIXTURE_NOT_JSON__', '__FIXTURE_BAD_KIND__', '__FIXTURE_TOO_LONG__', '__FIXTURE_EMPTY__']) {
  const r = await run(f);
  check(`★ ${f}: פלט פגום לא מגיע להורה`, r.decision.reply === PROVIDER_ERROR_REPLY && !/17:00|מקום בקבוצה/.test(r.sent[0]?.body ?? ''));
}

// ═══════ 7. הסכימה ═══════
console.log('\nהסכימה:');
{
  const v = validateAnswer(JSON.stringify({ kind: 'no_answer', reply: 'אולי כן אולי לא', confidence: 0.9 }), true);
  check('★ no_answer מקבל תמיד את המשפט הקבוע, גם אם המודל ניסח אחרת', v.ok && v.answer.reply === NO_ANSWER_REPLY);
  const l = validateAnswer(JSON.stringify({ kind: 'lead', reply: 'x', lead: { student_name: 'א' }, lead_complete: true }), true);
  check('★ lead_complete=true עם פרטים חסרים → false', l.ok && l.answer.lead_complete === false);
  const w = validateAnswer('```json\n{"kind":"answer","reply":"שלום","confidence":0.9}\n```', true);
  check('גדר markdown מוסרת', w.ok && w.answer.reply === 'שלום');
}

// ═══════ 8. מבני ═══════
console.log('\nמבני:');
const webhook = codeOf('supabase/functions/wa-webhook/index.ts');
check('★ wa-webhook מנתב את מסלול הלקוחות ל-answerCustomer', /answerCustomer\(/.test(webhook));
check('★ התשובה נרשמת כהודעה יוצאת (היסטוריית השיחה)', /direction:\s*'out'/.test(webhook));
const customer = codeOf('supabase/functions/_shared/customer.ts');
check('customer.ts אינו שולח בוואטסאפ בעצמו (זה של deliverReply)', !/sendText|whatsappProvider/.test(customer));
check('customer.ts אינו מייבא לקוח מסד — הוא מוזרק', !/supabase\.ts|adminClient|createClient/.test(customer));

console.log(fails === 0 ? '\nסוכן הלקוחות: כל התרחישים עברו' : `\n${fails} בדיקות נכשלו`);
process.exit(fails ? 1 : 0);
