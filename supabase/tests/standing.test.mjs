/**
 * הוראת קבע — הקוד שמדבר עם SUMIT (_shared/standing.ts, standing-sync.ts),
 * ה-checkout (אישור לפני דף תשלום) והעצירה (SUMIT קודם, ואז אצלנו).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codeOf } from './_code.mjs';

process.env.SUMIT_DRY_RUN = 'true';
const dir = mkdtempSync(join(tmpdir(), 'so-'));
const bundle = (src, name) => {
  const out = join(dir, name);
  execFileSync('npx', ['esbuild', src, '--bundle', '--format=esm', `--outfile=${out}`, '--log-level=error',
    '--define:Deno.env.get=__denoEnvGet', '--banner:js=const __denoEnvGet = (k) => process.env[k];']);
  return out;
};
const so = await import(bundle('supabase/functions/_shared/standing.ts', 'standing.mjs'));
const { syncStandingOrders } = await import(bundle('supabase/functions/_shared/standing-sync.ts', 'standing-sync.mjs'));
const { rescheduleStanding } = await import(bundle('supabase/functions/_shared/standing-reschedule.ts', 'standing-reschedule.mjs'));

let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`); };

console.log('\nהבקשה ל-SUMIT:');
{
  const b = so.recurringChargeBody({ customerId: 777, amount: 110, installments: 9, dateStart: '2026-11-05', itemName: 'x', description: 'y' });
  check('★ על הכרטיס השמור: בלי PaymentMethod, בלי פרטי כרטיס', !('PaymentMethod' in b) && !JSON.stringify(b).includes('CreditCard'));
  check('★ הלקוחה של התשלום הראשון', b.Customer.ID === 777);
  check('★ 9 חיובים חודשיים של 110 מהחודש הבא', b.Items[0].Recurrence === 9 && b.Items[0].Duration_Months === 1 && b.Items[0].UnitPrice === 110 && b.Items[0].Date_Start === '2026-11-05');
}

console.log('\nשינוי יום חיוב — הבקשה ל-SUMIT:');
{
  const b = so.recurringUpdateBody({ customerId: 777, recurringId: 42, nextDate: '2026-12-20', remaining: 7 });
  check('★ התאריך הבא + מספר החיובים שנותרו (כדי ש-SUMIT תחשב את האחרון מחדש)', JSON.stringify(b) === JSON.stringify({ Customer: { ID: 777 }, RecurringCustomerItemID: 42, NextPaymentDate: '2026-12-20', Recurrence: 7 }));
  check('★ בלי סכום ובלי פרטי כרטיס — הסכום לא משתנה', !('UnitPrice' in b) && !JSON.stringify(b).includes('CreditCard') && !('PaymentMethod' in b));
  check('addMonths: חודשים קדימה, גם מעבר שנה', so.addMonths('2026-12-20', 6) === '2027-06-20' && so.addMonths('2026-11-05', 0) === '2026-11-05' && so.addMonths('2027-01-31', 1) === '2027-02-28');
  // הרצה יבשה: עקבית — יצירה, שינוי, ו-list מחזיר את התאריך החדש והאחרון.
  const dry = so.standingProvider();
  const c = await dry.create({ customerId: 555, amount: 100, installments: 9, dateStart: '2026-11-05', itemName: 'x', description: 'y' });
  const before = (await dry.list(555)).find((i) => i.ID === c.recurringId);
  await dry.update({ customerId: 555, recurringId: c.recurringId, nextDate: '2026-11-20', remaining: 9 });
  const after = (await dry.list(555)).find((i) => i.ID === c.recurringId);
  check('הרצה יבשה: list מחזיר את התאריך הבא והאחרון, ומתעדכן אחרי שינוי', before?.Date_NextBilling === '2026-11-05' && before?.Date_Last === '2027-07-05'
        && after?.Date_NextBilling === '2026-11-20' && after?.Date_Last === '2027-07-20');
  check('הרצה יבשה: הוראה של לקוחה אחרת — לא משתנה', (await dry.update({ customerId: 1, recurringId: c.recurringId, nextDate: '2026-11-21', remaining: 9 })).ok === false);
}

console.log('\nשינוי יום חיוב — הזרימה (rescheduleStanding):');
{
  const ID = '6471e835-d6d3-48ce-9798-3e10f5ac7c70';
  const PLAN = { ok: true, next: '2026-12-20', final: '2027-06-20', remaining: 7, day: 20, from: '2026-12-05', from_day: 5, kind: 'charged_this_month',
                 current: 'עכשיו', reason: 'סיבה', sentence: 'החיוב הבא יהיה ב-20/12, ואחריו כל 20 לחודש.' };
  // plans — מה שהמסד מחזיר לתצוגה בכל קריאה (ראשונה, אחרי הרענון מ-SUMIT).
  function env({ plans = [PLAN, PLAN], denied = null, item = { ID: 42, Status: 0, Date_NextBilling: '2026-12-05T00:00:00+02:00', Date_PreviousBilling: '2026-11-05T00:00:00+02:00', Date_Last: '2027-06-05T00:00:00+03:00' },
                 observed = { remaining_ok: true, remaining: 7, sumit_remaining: 7 }, listThrows = false, updateOk = true } = {}) {
    const log = [];
    let n = 0;
    const user = { rpc: async (fn, args) => { log.push(['user', fn, args]); return denied ? { data: null, error: { message: denied } } : { data: plans[Math.min(n++, plans.length - 1)], error: null }; } };
    const admin = {
      rpc: async (fn, args) => { log.push(['admin', fn, args]); return { data: fn === 'rpc_standing_billing_observed' ? observed : null, error: null }; },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { sumit_customer_id: 777, sumit_recurring_id: 42 }, error: null }) }) }) }),
    };
    const sumit = {
      list: async (cid) => { log.push(['sumit', 'list', cid]); if (listThrows) throw new Error('SUMIT לא זמינה'); return item ? [item] : []; },
      update: async (i) => { log.push(['sumit', 'update', i]); return updateOk ? { ok: true } : { ok: false, error: 'נדחה' }; },
      create: async () => ({ ok: false, error: 'x' }), cancel: async () => ({ ok: true }),
    };
    return { log, user, admin, sumit, run: (input = { id: ID, day: 20, expected: '2026-12-20' }) => rescheduleStanding(user, admin, sumit, input, 'owner-1') };
  }
  const updated = (e) => e.log.some(([who, fn]) => who === 'sumit' && fn === 'update');
  const marked = (e) => e.log.some(([, fn]) => fn === 'rpc_standing_order_rescheduled');
  {
    const e = env(); const r = await e.run();
    const order = e.log.map(([who, fn]) => `${who}:${fn}`);
    check('★ הצלחה: תוכנית → בדיקה ב-SUMIT → קליטה → תוכנית שוב → עדכון ב-SUMIT → רישום אצלנו, בסדר הזה', r.status === 200 && r.body.ok
          && JSON.stringify(order) === JSON.stringify(['user:rpc_standing_reschedule_preview', 'sumit:list', 'admin:rpc_standing_billing_observed', 'user:rpc_standing_reschedule_preview', 'sumit:update', 'admin:rpc_standing_order_rescheduled']), JSON.stringify(order));
    const up = e.log.find(([who, fn]) => who === 'sumit' && fn === 'update')?.[2];
    check('★ ל-SUMIT: התאריך מהתוכנית ומספר החיובים שנותרו', up?.nextDate === '2026-12-20' && up?.remaining === 7 && up?.customerId === 777 && up?.recurringId === 42);
    const ob = e.log.find(([, fn]) => fn === 'rpc_standing_billing_observed')?.[2];
    check('המצב מ-SUMIT נקלט (כולל התאריך האחרון — כמה נותרו)', ob?.p_next === '2026-12-05' && ob?.p_prev === '2026-11-05' && ob?.p_final === '2027-06-05');
    const mk = e.log.find(([, fn]) => fn === 'rpc_standing_order_rescheduled')?.[2];
    check('★ ביומן: מי (המשתמשת), מאיזה תאריך לאיזה', mk?.p_by === 'owner-1' && mk?.p_from === '2026-12-05' && mk?.p_to === '2026-12-20' && mk?.p_day === 20 && mk?.p_remaining === 7);
    check('ההרשאה נבדקת בהרשאות המשתמשת (לא service_role)', e.log.filter(([who, fn]) => fn === 'rpc_standing_reschedule_preview').every(([who]) => who === 'user'));
  }
  {
    const e = env({ denied: 'רק הבעלים יכולה לשנות את יום החיוב' }); const r = await e.run();
    check('★ לא בעלים — 403, ושום קריאה ל-SUMIT', r.status === 403 && !e.log.some(([who]) => who === 'sumit'));
  }
  {
    const e = env({ plans: [{ ok: false, error: 'החיוב שתוכנן ל-05/12 עוד לא נקלט מ-SUMIT.' }] }); const r = await e.run();
    check('תוכנית שנדחתה (חיוב היום וכו\') — ההודעה חוזרת, ושום קריאה ל-SUMIT', r.status === 409 && /עוד לא נקלט/.test(r.body.error) && !e.log.some(([who]) => who === 'sumit'));
  }
  {
    const e = env({ plans: [PLAN, { ...PLAN, next: '2027-01-20', kind: 'charged_this_month', sentence: 'החיוב הבא יהיה ב-20/01' }] }); const r = await e.run();
    check('★ המצב השתנה בינתיים (חיוב נקלט עכשיו) — לא משנים, מחזירים את התוכנית החדשה לאישור', r.status === 409 && r.body.changed === true && r.body.plan?.next === '2027-01-20' && !updated(e) && !marked(e));
  }
  {
    const e = env({ observed: { remaining_ok: false, remaining: 7, sumit_remaining: 6 } }); const r = await e.run();
    check('★ לפי SUMIT נותרו 6 ולפי המערכת 7 — לא נוגעים', r.status === 409 && /נותרו 6 חיובים, ולפי המערכת 7/.test(r.body.error) && !updated(e));
  }
  {
    const e = env({ observed: { remaining_ok: null, remaining: 7, sumit_remaining: null } }); const r = await e.run();
    check('בלי התאריך האחרון מ-SUMIT — לא נוגעים', r.status === 409 && !updated(e));
  }
  {
    const e = env({ listThrows: true }); const r = await e.run();
    check('SUMIT לא זמינה — "לא שיניתי כלום"', r.status === 502 && /לא שיניתי כלום/.test(r.body.error) && !updated(e) && !marked(e));
  }
  {
    const e = env({ item: null }); const r = await e.run();
    check('ההוראה לא נמצאה אצל הלקוחה ב-SUMIT — לא נוגעים', r.status === 502 && !updated(e));
  }
  {
    const e = env({ updateOk: false }); const r = await e.run();
    check('★ SUMIT סירבה לעדכון — לא מסמנים אצלנו', r.status === 502 && /שום דבר לא השתנה/.test(r.body.error) && !marked(e));
  }
  {
    const e = env();
    const bad = await Promise.all([e.run({ id: 'x', day: 20, expected: '2026-12-20' }), e.run({ id: ID, day: 29, expected: '2026-12-20' }), e.run({ id: ID, day: 20 })]);
    check('קלט פגום (מזהה / יום 29 / בלי התאריך שהוצג) — 400, בלי שום קריאה', bad.every((r) => r.status === 400) && e.log.length === 0);
  }
}

console.log('\nהסנכרון:');
function fakeDb(setup, toCheck = []) {
  const calls = [], inserts = [];
  return { calls, inserts, db: {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (fn === 'rpc_standing_orders_to_setup') return { data: setup, error: null };
      if (fn === 'rpc_standing_orders_to_check') return { data: toCheck, error: null };
      if (fn === 'rpc_standing_order_created') return { data: 'order-1', error: null };
      if (fn === 'rpc_record_standing_charge') return { data: { ok: true, duplicate: false, valid: args.p_valid }, error: null };
      if (fn === 'rpc_standing_billing_observed') return { data: { ok: true, charge: args.p_prev ? { ok: true, duplicate: false, valid: true } : null }, error: null };
      return { data: { ok: true }, error: null };
    },
    from: () => ({ insert: async (row) => { inserts.push(row); return { error: null }; } }),
  } };
}
const S = { link_id: 'L1', student_name: 'רות', branch: 'ביתר', customer_id: 777, amount: 110, installments: 9, installments_total: 10, date_start: '2026-11-05' };
{
  const f = fakeDb([S]);
  const r = await syncStandingOrders(f.db, so.standingProvider());
  const created = f.calls.find((c) => c.fn === 'rpc_standing_order_created');
  check('★ קישור ששולם → הוראה נוצרת ונרשמת', r.created === 1 && created?.args.p_ok === true && Number(created.args.p_recurring_id) > 0);
}
{
  const f = fakeDb([{ ...S, customer_id: null }]);
  const r = await syncStandingOrders(f.db, so.standingProvider());
  const created = f.calls.find((c) => c.fn === 'rpc_standing_order_created');
  check('★ בלי לקוחה מ-SUMIT — לא מנסה לחייב, נרשם ככישלון', r.setup_failed === 1 && created?.args.p_ok === false);
}
{
  // ספק שמחייב מיד ביצירה: נרשם ומתריע, לא נבלע.
  const sumit = { ...so.standingProvider(),
    create: async () => ({ ok: true, recurringId: 42, immediatePayment: { ID: 99, Amount: 110, Date: '2026-10-05', ValidPayment: true }, dryRun: false }),
    list: async () => [], cancel: async () => ({ ok: true }) };
  const f = fakeDb([S]);
  await syncStandingOrders(f.db, sumit);
  check('★ SUMIT חייבה מיד — החיוב נרשם', f.calls.some((c) => c.fn === 'rpc_record_standing_charge' && c.args.p_sumit_payment_id === 99));
  check('★ ...והבעלים מקבלת התראה', f.inserts.some((i) => i.kind === 'standing_order_immediate_charge'));
}
{
  // ★ הלקוחה שלנו בלבד (listforcustomer). חיוב חדש = Date_PreviousBilling; כישלון = הסטטוס (rpc_standing_order_status בתוך observed).
  const listed = [];
  const sumit = { create: async () => ({ ok: false, error: 'x', dryRun: false }),
    list: async (cid) => { listed.push(cid); return [{ ID: 42, Status: 0, Date_NextBilling: '2027-01-05T00:00:00', Date_PreviousBilling: '2026-12-05T00:00:00', Date_Last: '2027-08-05T00:00:00+03:00' }]; },
    cancel: async () => ({ ok: true }) };
  const f = fakeDb([], [{ id: 'O1', customer_id: 777, recurring_id: 42, amount: 110, date_start: '2026-11-05', last_checked_at: null, status: 'active' }]);
  const r = await syncStandingOrders(f.db, sumit);
  const ob = f.calls.find((c) => c.fn === 'rpc_standing_billing_observed');
  check('★ המצב מ-SUMIT מועבר למסד (קוד, החיוב הבא, החיוב הקודם)', ob?.args.p_sumit_status === 0 && ob.args.p_next === '2027-01-05' && ob.args.p_prev === '2026-12-05');
  check('★ וגם התאריך האחרון (Date_Last) — כמה נותרו לפי SUMIT', ob?.args.p_final === '2027-08-05');
  check('★ רק הלקוחה של ההוראה נשאלת', JSON.stringify(listed) === '[777]');
  check('חיוב שזוהה נספר', r.charges === 1, JSON.stringify(r));
}

console.log('\nהקוד סביב:');
{
  const checkout = codeOf('supabase/functions/sumit-checkout/index.ts');
  const iConsent = checkout.indexOf('rpc_standing_consent_required'), iPage = checkout.indexOf('createPaymentPage(');
  check('★ checkout: אישור הוראת הקבע נבדק ונשמר לפני דף התשלום', iConsent > 0 && iPage > iConsent && /if \(needsConsent\) \{\s*if \(new URL\(req\.url\)\.searchParams\.get\('consent'\) !== '1'\)/.test(checkout) && /rpc_standing_consent', \{ p_token: token \}/.test(checkout));
  const cancel = codeOf('supabase/functions/standing-order-cancel/index.ts');
  const iReq = cancel.indexOf('rpc_standing_order_cancel_request'), iSumit = cancel.indexOf('.cancel('), iMark = cancel.indexOf('rpc_standing_order_cancelled');
  check('★ עצירה: הרשאה במסד → ביטול ב-SUMIT → רק אז סימון אצלנו', iReq > 0 && iSumit > iReq && iMark > iSumit && /if \(!r\.ok\)/.test(cancel));
  check('עצירה: ההרשאה נבדקת בהרשאות המשתמשת, לא ב-service_role', /userClient\(authorization\)\.rpc\('rpc_standing_order_cancel_request'/.test(cancel));
  const pay = codeOf('src/pages/Pay.tsx');
  check('★ /pay: התיבה לא מסומנת מראש, והכפתור חסום עד הסימון', /const \[agree, setAgree\] = useState\(false\);/.test(pay) && /!info\.standing\.consented && !agree/.test(pay));
  const resched = codeOf('supabase/functions/standing-order-reschedule/index.ts');
  check('שינוי יום חיוב: הפונקציה מריצה את הזרימה המשותפת, עם הרשאות המשתמשת', /rescheduleStanding\(userClient\(authorization\), adminClient\(\), standingProvider\(\), body, by\)/.test(resched));
  const cron = codeOf('supabase/functions/cron-sumit-sync/index.ts');
  check('הסנכרון השעתי מריץ גם את הוראות הקבע', /syncStandingOrders\(db, standingProvider\(\)\)/.test(cron));
}

console.log(fails === 0 ? '\nהוראת קבע: הכל במקום' : `\n${fails} בדיקות נכשלו`);
process.exit(fails ? 1 : 0);
