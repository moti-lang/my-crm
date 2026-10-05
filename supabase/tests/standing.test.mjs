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

let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`); };

console.log('\nהבקשה ל-SUMIT:');
{
  const b = so.recurringChargeBody({ customerId: 777, amount: 110, installments: 9, dateStart: '2026-11-05', itemName: 'x', description: 'y' });
  check('★ על הכרטיס השמור: בלי PaymentMethod, בלי פרטי כרטיס', !('PaymentMethod' in b) && !JSON.stringify(b).includes('CreditCard'));
  check('★ הלקוחה של התשלום הראשון', b.Customer.ID === 777);
  check('★ 9 חיובים חודשיים של 110 מהחודש הבא', b.Items[0].Recurrence === 9 && b.Items[0].Duration_Months === 1 && b.Items[0].UnitPrice === 110 && b.Items[0].Date_Start === '2026-11-05');
}

console.log('\nהתאמת חיובים להוראה:');
{
  const order = { customer_id: 777, amount: 110, date_start: '2026-11-05' };
  const pays = [
    { ID: 1, CustomerID: 777, Amount: 110, Date: '2026-11-05T09:00:00+02:00', ValidPayment: true },
    { ID: 2, CustomerID: 777, Amount: 110, Date: '2026-12-05T09:00:00+02:00', ValidPayment: false },
    { ID: 3, CustomerID: 888, Amount: 110, Date: '2026-11-05T09:00:00+02:00', ValidPayment: true },
    { ID: 4, CustomerID: 777, Amount: 210, Date: '2026-10-05T09:00:00+02:00', ValidPayment: true },
    { ID: 5, CustomerID: 777, Amount: 110, Date: '2026-09-01T09:00:00+02:00', ValidPayment: true },
  ];
  const ids = so.chargesForOrder(pays, order).map((p) => p.ID).sort();
  check('★ רק של הלקוחה, בסכום, מתאריך ההתחלה — כולל שנדחו', JSON.stringify(ids) === '[1,2]', JSON.stringify(ids));
  const w = so.paymentsWindow([{ date_start: '2026-11-05', last_checked_at: null }], new Date('2026-11-20T00:00:00Z'));
  check('חלון החיפוש: מיומיים לפני ההתחלה ועד מחר', w.from === '2026-11-03' && w.to === '2026-11-21', JSON.stringify(w));
  check('אין הוראות — אין קריאה', so.paymentsWindow([]) === null);
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
    list: async () => [], payments: async () => [], cancel: async () => ({ ok: true }) };
  const f = fakeDb([S]);
  await syncStandingOrders(f.db, sumit);
  check('★ SUMIT חייבה מיד — החיוב נרשם', f.calls.some((c) => c.fn === 'rpc_record_standing_charge' && c.args.p_sumit_payment_id === 99));
  check('★ ...והבעלים מקבלת התראה', f.inserts.some((i) => i.kind === 'standing_order_immediate_charge'));
}
{
  const sumit = { create: async () => ({ ok: false, error: 'x', dryRun: false }),
    list: async () => [{ ID: 42, Status: 14, Date_NextBilling: '2026-12-08T00:00:00', Date_PreviousBilling: '2026-12-05T00:00:00' }],
    payments: async () => [{ ID: 7, CustomerID: 777, Amount: 110, Date: '2026-12-05T09:00:00', ValidPayment: false },
                           { ID: 8, CustomerID: 777, Amount: 110, Date: '2026-11-05T09:00:00', ValidPayment: true }],
    cancel: async () => ({ ok: true }) };
  const f = fakeDb([], [{ id: 'O1', customer_id: 777, recurring_id: 42, amount: 110, date_start: '2026-11-05', last_checked_at: null, status: 'active' }]);
  const r = await syncStandingOrders(f.db, sumit);
  const st = f.calls.find((c) => c.fn === 'rpc_standing_order_status');
  check('★ המצב מ-SUMIT מועבר למסד (קוד, החיוב הבא)', st?.args.p_sumit_status === 14 && st.args.p_next === '2026-12-08');
  check('★ חיוב תקין וחיוב שנדחה — שניהם נרשמים', r.charges === 1 && r.declined === 1, JSON.stringify(r));
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
  const cron = codeOf('supabase/functions/cron-sumit-sync/index.ts');
  check('הסנכרון השעתי מריץ גם את הוראות הקבע', /syncStandingOrders\(db, standingProvider\(\)\)/.test(cron));
}

console.log(fails === 0 ? '\nהוראת קבע: הכל במקום' : `\n${fails} בדיקות נכשלו`);
process.exit(fails ? 1 : 0);
