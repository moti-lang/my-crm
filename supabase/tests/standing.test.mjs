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
const { applyStudentDiscount } = await import(bundle('supabase/functions/_shared/student-discount.ts', 'student-discount.mjs'));
const { retryStanding } = await import(bundle('supabase/functions/_shared/standing-retry.ts', 'standing-retry.mjs'));

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

console.log('\nהנחה לתלמידה — הזרימה (applyStudentDiscount):');
{
  const ST = '6471e835-d6d3-48ce-9798-3e10f5ac7c70', ORDER = 'b2a3c4d5-0000-4000-8000-000000000001';
  const NONE = { ok: true, stage: 'none', discount_after: 200, amount: 200, lines: ['ההנחה: 200 ₪'], standing: null, links: [] };
  const SO = { ok: true, stage: 'standing', discount_after: 140, amount: 140, lines: ['ההנחה: 140 ₪'], links: [],
               standing: { id: ORDER, from_monthly: 100, to_monthly: 80, remaining: 7, cut: 20, next: '2026-12-05' } };
  const item0 = { ID: 42, Status: 0, Date_NextBilling: '2026-12-05T00:00:00+02:00', Date_PreviousBilling: '2026-11-05T00:00:00+02:00', Date_Last: '2027-06-05T00:00:00+03:00', UnitPrice: 100 };
  function env({ plans = [NONE], denied = null, observed = { remaining_ok: true, remaining: 7, sumit_remaining: 7 }, updateOk = true, verifyPrice = null, applyResult = null } = {}) {
    const log = [], inserts = [];
    let n = 0, price = 100;
    const user = { rpc: async (fn, args) => { log.push(['user', fn, args]); return denied ? { data: null, error: { message: denied } } : { data: plans[Math.min(n++, plans.length - 1)], error: null }; } };
    const admin = {
      rpc: async (fn, args) => { log.push(['admin', fn, args]);
        if (fn === 'rpc_standing_billing_observed') return { data: observed, error: null };
        if (fn === 'rpc_discount_apply') return { data: applyResult ?? { ok: true }, error: null };
        return { data: null, error: null }; },
      from: (t) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { sumit_customer_id: 777, sumit_recurring_id: 42 }, error: null }) }) }),
                      insert: async (row) => { inserts.push([t, row]); return { error: null }; } }),
    };
    const sumit = {
      list: async () => { log.push(['sumit', 'list']); return [{ ...item0, UnitPrice: price }]; },
      update: async (i) => { log.push(['sumit', 'update', i]); if (updateOk) price = verifyPrice ?? i.unitPrice; return updateOk ? { ok: true } : { ok: false, error: 'נדחה' }; },
      create: async () => ({ ok: false, error: 'x' }), cancel: async () => ({ ok: true }),
    };
    return { log, inserts, run: (input) => applyStudentDiscount(user, admin, sumit, { student: ST, kind: 'ils', value: 200, reason: 'אחות שנייה', expected: 200, ...input }, 'owner-1') };
  }
  const calls = (e) => e.log.map(([who, fn]) => `${who}:${fn}`);
  {
    const e = env(); const r = await e.run();
    const ap = e.log.find(([, fn]) => fn === 'rpc_discount_apply')?.[2];
    check('★ בלי הוראת קבע: תוכנית (בהרשאות המשתמשת) → שמירה במסד, בלי שום קריאה ל-SUMIT', r.status === 200 && JSON.stringify(calls(e)) === '["user:rpc_discount_preview","admin:rpc_discount_apply"]', JSON.stringify(calls(e)));
    check('★ נשמרת ההנחה שהבעלים ראתה, עם הסיבה ועם מי', ap?.p_expected === 200 && ap?.p_reason === 'אחות שנייה' && ap?.p_by === 'owner-1' && ap?.p_to_monthly === null);
  }
  {
    const e = env(); const r = await e.run({ expected: 150 });
    check('★ התוכנית שונה ממה שהבעלים ראתה — לא נשמר, חוזרת התוכנית החדשה', r.status === 409 && r.body.changed === true && !calls(e).includes('admin:rpc_discount_apply'));
  }
  {
    const e = env({ denied: 'רק הבעלים יכולה לתת הנחה' }); const r = await e.run();
    check('★ לא בעלים — 403, בלי שמירה ובלי SUMIT', r.status === 403 && !e.log.some(([who, fn]) => who === 'sumit' || fn === 'rpc_discount_apply'));
  }
  {
    const e = env(); const r = await e.run({ reason: '  ' });
    check('בלי סיבה — 400, בלי שום קריאה', r.status === 400 && e.log.length === 0);
  }
  {
    const e = env({ plans: [SO, SO] }); const r = await e.run({ value: 140, expected: 140 });
    check('★ הוראת קבע: תוכנית → בדיקה ב-SUMIT → קליטה → תוכנית שוב → עדכון → אימות → רק אז שמירה',
      r.status === 200 && JSON.stringify(calls(e)) === '["user:rpc_discount_preview","sumit:list","admin:rpc_standing_billing_observed","user:rpc_discount_preview","sumit:update","sumit:list","admin:rpc_discount_apply"]', JSON.stringify(calls(e)));
    const up = e.log.find(([, fn]) => fn === 'update')?.[2];
    check('★ ל-SUMIT: סכום חדש, ואותו תאריך ואותו מספר חיובים', up?.unitPrice === 80 && up?.nextDate === '2026-12-05' && up?.remaining === 7);
    check('נשמר עם הסכום החודשי ש-SUMIT קיבלה', e.log.find(([, fn]) => fn === 'rpc_discount_apply')?.[2]?.p_to_monthly === 80);
  }
  {
    const e = env({ plans: [SO, SO], verifyPrice: 100 }); const r = await e.run({ value: 140, expected: 140 });
    check('★ SUMIT לא מאשרת את הסכום החדש — לא נשמר אצלנו, והתראה קריטית', r.status === 502 && !calls(e).includes('admin:rpc_discount_apply')
          && e.inserts.some(([t, row]) => t === 'system_alerts' && row.kind === 'standing_order_discount_mismatch' && row.severity === 'critical'));
  }
  {
    const e = env({ plans: [SO, SO], observed: { remaining_ok: false, remaining: 7, sumit_remaining: 6 } }); const r = await e.run({ value: 140, expected: 140 });
    check('★ כמה נותרו לפי SUMIT ≠ לפי המערכת — לא נוגעים', r.status === 409 && !calls(e).includes('sumit:update') && !calls(e).includes('admin:rpc_discount_apply'));
  }
  {
    const e = env({ plans: [SO, { ...SO, standing: { ...SO.standing, to_monthly: 82 } }] }); const r = await e.run({ value: 140, expected: 140 });
    check('המצב ב-SUMIT השתנה בינתיים — לא מעדכנים, חוזרת התוכנית החדשה', r.status === 409 && r.body.changed === true && !calls(e).includes('sumit:update'));
  }
  {
    const e = env({ plans: [SO, SO], updateOk: false }); const r = await e.run({ value: 140, expected: 140 });
    check('★ SUMIT סירבה — לא נשמר אצלנו', r.status === 502 && !calls(e).includes('admin:rpc_discount_apply'));
  }
  check('גוף העדכון ל-SUMIT: UnitPrice רק כשמשנים סכום', so.recurringUpdateBody({ customerId: 1, recurringId: 2, nextDate: '2026-12-05', remaining: 7, unitPrice: 80 }).UnitPrice === 80
        && !('UnitPrice' in so.recurringUpdateBody({ customerId: 1, recurringId: 2, nextDate: '2026-12-05', remaining: 7 })));
  const fnCode = codeOf('supabase/functions/student-discount/index.ts');
  check('הפונקציה student-discount מריצה את הזרימה המשותפת, עם הרשאות המשתמשת', /applyStudentDiscount\(userClient\(authorization\), adminClient\(\), standingProvider\(\), body, by\)/.test(fnCode));
}

console.log('\nניסיון חיוב חוזר — הזרימה (retryStanding):');
{
  const ID = 'c3a4b5c6-0000-4000-8000-000000000001';
  const CHARGE = { ok: true, stage: 'charge', amount: 137, missed: '2026-11-06', remaining_after: 6, next: '2026-12-06', final: '2027-05-06', day: 6, lines: ['x'] };
  const RENEW = { ...CHARGE, stage: 'renew' };
  const disabled = { ID: 42, Status: 3, Date_NextBilling: '2026-11-06T00:00:00+02:00', Date_PreviousBilling: null, Date_Last: '2027-05-06T00:00:00+03:00' };
  function env({ plans = [CHARGE, RENEW], denied = null, item = disabled, charge = { ok: true, payment: { ID: 9001, Amount: 137, Date: '2026-11-08T10:00:00+02:00', ValidPayment: true, StatusDescription: ' (קוד 000)' } },
                 charged = { ok: true, valid: true, remaining: 6 }, create = { ok: true, recurringId: 77, immediatePayment: null }, renewed = { ok: true } } = {}) {
    const log = [], inserts = [];
    let n = 0;
    const user = { rpc: async (fn, args) => { log.push(['user', fn, args]); return denied ? { data: null, error: { message: denied } } : { data: plans[Math.min(n++, plans.length - 1)], error: null }; } };
    const admin = {
      rpc: async (fn, args) => { log.push(['admin', fn, args]);
        if (fn === 'rpc_standing_retry_charged') return { data: { ...charged, valid: args.p_valid && charged.valid }, error: null };
        if (fn === 'rpc_standing_retry_renewed') return { data: renewed, error: null };
        return { data: null, error: null }; },
      from: (t) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { sumit_customer_id: 777, sumit_recurring_id: 42, amount: 137,
                        students: { full_name: 'תמר וינשטוק' }, branches: { name: 'ביתר' } }, error: null }) }) }),
                      insert: async (row) => { inserts.push([t, row]); return { error: null }; } }),
    };
    const sumit = {
      list: async () => { log.push(['sumit', 'list']); return item ? [item] : []; },
      chargeOnce: async (i) => { log.push(['sumit', 'chargeOnce', i]); return charge; },
      create: async (i) => { log.push(['sumit', 'create', i]); return create; },
      update: async () => ({ ok: true }), cancel: async () => ({ ok: true }),
    };
    return { log, inserts, run: (input) => retryStanding(user, admin, sumit, { id: ID, stage: 'charge', next: '2026-12-06', ...input }, 'owner-1') };
  }
  const calls = (e) => e.log.map(([who, fn]) => `${who}:${fn}`);
  {
    const e = env(); const r = await e.run();
    check('★ עבר: תוכנית → SUMIT (מצב ההוראה) → חיוב אחד → נרשם → תוכנית שוב → הוראה חדשה → נרשמה',
      r.status === 200 && r.body.charged === 137 && r.body.renewed === true && JSON.stringify(calls(e)) ===
      '["user:rpc_standing_retry_preview","sumit:list","sumit:chargeOnce","admin:rpc_standing_retry_charged","user:rpc_standing_retry_preview","sumit:create","admin:rpc_standing_retry_renewed"]', JSON.stringify(calls(e)));
    const ch = e.log.find(([, fn]) => fn === 'chargeOnce')?.[2];
    check('★ החיוב: הסכום מהתוכנית, ללקוחה שלנו — בלי פרטי כרטיס', ch?.amount === 137 && ch?.customerId === 777 && Object.keys(ch).sort().join() === 'amount,customerId,description,itemName');
    const rec = e.log.find(([, fn]) => fn === 'rpc_standing_retry_charged')?.[2];
    check('★ נרשם מה ש-SUMIT החזירה: מזהה, סכום, עבר, הסיבה, ומי', rec?.p_sumit_payment_id === 9001 && rec?.p_amount === 137 && rec?.p_valid === true && rec?.p_by === 'owner-1');
    const cr = e.log.find(([, fn]) => fn === 'create')?.[2];
    check('★ ההוראה החדשה: החיובים שנותרו (6), מ-06/12, אותו סכום', cr?.installments === 6 && cr?.dateStart === '2026-12-06' && cr?.amount === 137 && cr?.customerId === 777);
    const rn = e.log.find(([, fn]) => fn === 'rpc_standing_retry_renewed')?.[2];
    check('נרשם המזהה החדש מ-SUMIT', rn?.p_recurring_id === 77 && rn?.p_next === '2026-12-06' && rn?.p_remaining === 6);
  }
  {
    const e = env({ charge: { ok: true, payment: { ID: 9002, Amount: 137, Date: '2026-11-08T10:00:00+02:00', ValidPayment: false, StatusDescription: ' סירוב (קוד 004)' } } });
    const r = await e.run();
    check('★ נדחה: נרשם (עם הסיבה), ההוראה לא מחודשת, והבעלים רואה את הסיבה', r.status === 409 && r.body.declined === true && r.body.error.includes('סירוב (קוד 004)')
          && calls(e).includes('admin:rpc_standing_retry_charged') && !calls(e).includes('sumit:create'));
  }
  {
    const e = env({ charge: { ok: false, error: 'SUMIT: אין אמצעי תשלום ללקוח' } }); const r = await e.run();
    check('★ SUMIT לא ביצעה (שגיאה) — "לא חויב כלום", בלי רישום ובלי חידוש', r.status === 502 && r.body.error.includes('לא חויב כלום')
          && !calls(e).includes('admin:rpc_standing_retry_charged') && !calls(e).includes('sumit:create'));
  }
  {
    const e = env({ charge: { ok: false, error: 'fetch failed', uncertain: true } }); const r = await e.run();
    check('★ לא ידוע אם חויב (החיבור נפל) — לא "לא חויב", התראה קריטית, בלי רישום ובלי חידוש', r.status === 502 && r.body.uncertain === true
          && r.body.error.includes('לא ברור אם החיוב בוצע') && !r.body.error.includes('לא חויב כלום') && !calls(e).includes('admin:rpc_standing_retry_charged')
          && !calls(e).includes('sumit:create') && e.inserts.some(([t, row]) => t === 'system_alerts' && row.kind === 'standing_retry_uncertain' && row.severity === 'critical'));
    check('★ ...ונרשם במסד שלא ברור (ניסיון נוסף ייחסם)', e.log.some(([who, fn, a]) => who === 'admin' && fn === 'rpc_standing_retry_uncertain' && a.p_id === ID && a.p_error === 'fetch failed'));
  }
  {
    const e = env({ item: { ...disabled, Status: 14 } }); const r = await e.run();
    check('★ לפי SUMIT ההוראה בניסיון חוזר משלה (14) — לא מחייבים במקביל', r.status === 409 && !calls(e).includes('sumit:chargeOnce'));
  }
  {
    const e = env({ item: null }); const r = await e.run();
    check('ההוראה לא נמצאה אצל הלקוחה ב-SUMIT — לא מחייבים', r.status === 502 && !calls(e).includes('sumit:chargeOnce'));
  }
  {
    const e = env({ create: { ok: false, error: 'SUMIT: שגיאה' } }); const r = await e.run();
    check('★ החיוב עבר אבל החידוש נכשל: נשאר רשום, התראה קריטית, וההודעה אומרת "בלי חיוב נוסף"', r.status === 502 && r.body.charged === 137
          && r.body.error.includes('בלי חיוב נוסף') && !calls(e).includes('admin:rpc_standing_retry_renewed')
          && e.inserts.some(([t, row]) => t === 'system_alerts' && row.kind === 'standing_renew_failed' && row.severity === 'critical'));
  }
  {
    const e = env({ plans: [RENEW, RENEW] }); const r = await e.run({ stage: 'renew' });
    check('★ "חידוש" (אחרי חיוב שעבר): רק הוראה חדשה — בלי חיוב ובלי בדיקת מצב', r.status === 200 && r.body.charged === 0 && r.body.renewed === true
          && JSON.stringify(calls(e)) === '["user:rpc_standing_retry_preview","user:rpc_standing_retry_preview","sumit:create","admin:rpc_standing_retry_renewed"]', JSON.stringify(calls(e)));
  }
  {
    const e = env(); const r = await e.run({ stage: 'renew' });
    check('★ הבעלים ראתה "חידוש" אבל עכשיו זה "חיוב" (או להפך) — לא נוגעים', r.status === 409 && r.body.changed === true && e.log.every(([who]) => who === 'user'));
  }
  {
    const e = env(); const r = await e.run({ next: '2026-12-07' });
    check('התאריך הבא שונה ממה שהבעלים ראתה — לא נוגעים', r.status === 409 && r.body.changed === true && !calls(e).includes('sumit:chargeOnce'));
  }
  {
    const e = env({ denied: 'רק הבעלים יכולה לנסות חיוב חוזר' }); const r = await e.run();
    check('★ לא בעלים — 403, בלי SUMIT', r.status === 403 && !e.log.some(([who]) => who === 'sumit'));
  }
  {
    const e = env({ charged: { ok: true, valid: true, remaining: 0 } }); const r = await e.run();
    check('החיוב האחרון עבר — הסתיים, בלי הוראה חדשה', r.status === 200 && r.body.completed === true && !calls(e).includes('sumit:create'));
  }
  check('גוף החיוב ל-SUMIT: הלקוחה והפריט — בלי PaymentMethod (הכרטיס השמור)', (() => {
    const b = so.chargeOnceBody({ customerId: 777, amount: 137, itemName: 'x', description: 'y' });
    return b.Customer.ID === 777 && b.Items[0].UnitPrice === 137 && !('PaymentMethod' in b) && !('SingleUseToken' in b) && b.VATIncluded === true;
  })());
  const fnCode = codeOf('supabase/functions/standing-order-retry/index.ts');
  check('הפונקציה standing-order-retry מריצה את הזרימה המשותפת, עם הרשאות המשתמשת', /retryStanding\(userClient\(authorization\), adminClient\(\), standingProvider\(\), body, by\)/.test(fnCode));
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
  check('★ checkout: אישור הוראת הקבע נבדק ונשמר לפני דף התשלום', iConsent > 0 && iPage > iConsent && /if \(needsConsent\) \{\s*if \(new URL\(req\.url\)\.searchParams\.get\('consent'\) !== '1'\)/.test(checkout) && /rpc_standing_consent', \{ p_token: token, p_day: day \}/.test(checkout));
  check('★ checkout: יום החיוב מהדף — רק 1–2 ספרות; השרת בודק 1–28 ומסרב עם הסבר', /const day = dayParam && \/\^\\d\{1,2\}\$\/\.test\(dayParam\) \? Number\(dayParam\) : null;/.test(checkout)
        && /if \(!c\?\.ok\) return json\(\{ ok: false, error: c\?\.error/.test(checkout));
  const cancel = codeOf('supabase/functions/standing-order-cancel/index.ts');
  const iReq = cancel.indexOf('rpc_standing_order_cancel_request'), iSumit = cancel.indexOf('.cancel('), iMark = cancel.indexOf('rpc_standing_order_cancelled');
  check('★ עצירה: הרשאה במסד → ביטול ב-SUMIT → רק אז סימון אצלנו', iReq > 0 && iSumit > iReq && iMark > iSumit && /if \(!r\.ok\)/.test(cancel));
  check('עצירה: ההרשאה נבדקת בהרשאות המשתמשת, לא ב-service_role', /userClient\(authorization\)\.rpc\('rpc_standing_order_cancel_request'/.test(cancel));
  const pay = codeOf('src/pages/Pay.tsx');
  check('★ /pay: יום אחר מבטל את הסימון (נוסח אחר = אישור מחדש), והיום נשלח עם האישור', /setDay\(v\); setAgree\(false\);/.test(pay) && /&consent=1&day=\$\{encodeURIComponent\(day\)\}/.test(pay));
  check('★ /pay: התיבה לא מסומנת מראש, והכפתור חסום עד הסימון', /const \[agree, setAgree\] = useState\(false\);/.test(pay) && /!info\.standing\.consented && \(!agree \|\| !dayReady\)/.test(pay));
  const resched = codeOf('supabase/functions/standing-order-reschedule/index.ts');
  check('שינוי יום חיוב: הפונקציה מריצה את הזרימה המשותפת, עם הרשאות המשתמשת', /rescheduleStanding\(userClient\(authorization\), adminClient\(\), standingProvider\(\), body, by\)/.test(resched));
  const cron = codeOf('supabase/functions/cron-sumit-sync/index.ts');
  check('הסנכרון השעתי מריץ גם את הוראות הקבע', /syncStandingOrders\(db, standingProvider\(\)\)/.test(cron));
}

console.log(fails === 0 ? '\nהוראת קבע: הכל במקום' : `\n${fails} בדיקות נכשלו`);
process.exit(fails ? 1 : 0);
