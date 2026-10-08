#!/usr/bin/env node
/**
 * ★ פרטיות מול SUMIT (0036): המערכת לא פותחת תשלום או קבלה של מי שאינו שלנו.
 *
 * החשבון ב-SUMIT הוא החשבון העסקי של הלקוחה — עם תשלומים של לקוחות אחרים שאינם
 * קשורים לחוג. כאן: SUMIT מזויפת (fetch מיורט) עם תשלום אחד שלנו ו-30 של אחרים,
 * כולם באותו סכום. כל פנייה נרשמת: איזה נתיב, איזה תשלום, איזו קבלה. הבדיקה נכשלת
 * אם המערכת פתחה קבלה שאינה שלנו, שלפה רשימת תשלומים, או פנתה ל-SUMIT בלי סיבה.
 *   node supabase/tests/sumit-privacy.test.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import { codeOf } from './_code.mjs';

// הספק האמיתי (לא ההרצה היבשה), מול SUMIT מזויפת.
process.env.SUMIT_DRY_RUN = 'false';
process.env.SUMIT_COMPANY_ID = '1';
process.env.SUMIT_API_KEY = 'fake';
const dir = mkdtempSync(join(tmpdir(), 'sumit-priv-'));
const bundle = (src, name) => {
  const out = join(dir, name);
  execFileSync('npx', ['esbuild', src, '--bundle', '--format=esm', `--outfile=${out}`, '--log-level=error',
    '--define:Deno.env.get=__denoEnvGet', '--banner:js=const __denoEnvGet = (k) => process.env[k];']);
  return out;
};
const sumit = await import(bundle('supabase/functions/_shared/sumit.ts', 'sumit.mjs'));
const { syncPaymentLink } = await import(bundle('supabase/functions/_shared/sumit-sync.ts', 'sync.mjs'));
const { syncStandingOrders } = await import(bundle('supabase/functions/_shared/standing-sync.ts', 'standing-sync.mjs'));
const standing = await import(bundle('supabase/functions/_shared/standing.ts', 'standing.mjs'));

let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`); };

// ─────────── SUMIT מזויפת ───────────
const OURS = { ID: 5001, CustomerID: 77, Amount: 300, Date: '2026-10-08T10:05:00+03:00', ValidPayment: true, Status: '000', DocumentID: 9001 };
const payments = new Map([[OURS.ID, OURS]]);
const documents = new Map([[9001, { Customer: { ID: 77, Name: 'שלנו', ExternalIdentifier: 'tl-ours' }, DocumentDownloadURL: 'https://pay/9001' }]]);
for (let i = 2; i <= 31; i++) {   // 30 תשלומים של לקוחות אחרים — אותו סכום, אחרי הקישור
  payments.set(5000 + i, { ID: 5000 + i, CustomerID: 100 + i, Amount: 300, Date: '2026-10-08T11:00:00+03:00', ValidPayment: true, Status: '000', DocumentID: 9000 + i });
  documents.set(9000 + i, { Customer: { ID: 100 + i, Name: `לקוח ${i}`, ExternalIdentifier: `other-${i}` }, DocumentDownloadURL: `https://pay/${9000 + i}` });
}
const isOursPayment = (id) => id === OURS.ID;
const isOursDoc = (id) => id === OURS.DocumentID;
let log = [];
globalThis.fetch = async (url, init) => {
  const path = new URL(String(url)).pathname;
  const body = JSON.parse(init.body);
  log.push({ path, body });
  const env = (Data) => new Response(JSON.stringify({ Data, Status: 0, UserErrorMessage: null, TechnicalErrorDetails: null }), { status: 200 });
  if (path === '/billing/payments/get/') return env({ Payment: payments.get(Number(body.PaymentID)) ?? null });
  if (path === '/accounting/documents/getdetails/') { const d = documents.get(Number(body.DocumentID)); return env({ Document: d, DocumentDownloadURL: d?.DocumentDownloadURL }); }
  if (path === '/billing/payments/list/') return env({ Payments: [...payments.values()] });
  if (path === '/billing/recurring/listforcustomer/') return env({ RecurringItems: [{ ID: 1, Status: 0, Date_NextBilling: '2026-11-07', Date_PreviousBilling: '2026-10-07' }] });
  return env(null);
};
const foreignTouched = () => log.filter((c) =>
  (c.path === '/billing/payments/get/' && !isOursPayment(Number(c.body.PaymentID)))
  || (c.path === '/accounting/documents/getdetails/' && !isOursDoc(Number(c.body.DocumentID))));
const foreignReceipts = () => log.filter((c) => c.path === '/accounting/documents/getdetails/' && !isOursDoc(Number(c.body.DocumentID)));
const lists = () => log.filter((c) => c.path === '/billing/payments/list/');

function makeDb() {
  const rpcs = [], inserts = [];
  return { rpcs, inserts, db: {
    rpc: async (fn, args) => { rpcs.push({ fn, args }); return { data: fn === 'rpc_record_sumit_payment' ? { ok: true, duplicate: false, status: 'paid' } : {}, error: null }; },
    from: (t) => ({ insert: async (row) => { inserts.push({ t, row }); return { error: null }; } }),
  } };
}
const provider = sumit.sumitProvider();
const LINK = { token: 't'.repeat(64), external_identifier: 'tl-ours', amount: 300, created_at: '2026-10-08T07:00:00Z' };

console.log('\nקישור פתוח בלי מזהה מ-SUMIT (הסנכרון):');
{
  log = []; const { db } = makeDb();
  const r = await syncPaymentLink(db, provider, { ...LINK });
  check('★ אפס פניות ל-SUMIT', log.length === 0 && r.result === 'not_found', `${log.length} פניות`);
}

console.log('\nחזרה מהדף עם המזהים של התשלום שלנו:');
{
  log = []; const { db, rpcs } = makeDb();
  const r = await syncPaymentLink(db, provider, { ...LINK, payment_id: '5001', customer_candidate: '77', source: 'redirect' });
  check('★ התשלום שלנו אומת ונרשם', r.result === 'recorded', JSON.stringify(r));
  check('★ נפתחו רק התשלום שלנו והקבלה שלו (2 פניות)', log.length === 2 && foreignTouched().length === 0, JSON.stringify(log.map((c) => c.path + JSON.stringify(c.body.PaymentID ?? c.body.DocumentID))));
  check('נרשם עם מזהה התשלום והלקוחה', rpcs.some((c) => c.fn === 'rpc_record_sumit_payment' && c.args.p_sumit_payment_id === '5001' && c.args.p_sumit_customer_id === '77'));
}

console.log('\n★ זיוף: הורה שולחת מזהה של תשלום של לקוח אחר:');
{
  log = []; const { db, rpcs } = makeDb();
  const r = await syncPaymentLink(db, provider, { ...LINK, payment_id: '5002', customer_candidate: '77', source: 'redirect' });
  check('★ נדחה — לא נרשם תשלום', r.result === 'rejected' && !rpcs.some((c) => c.fn === 'rpc_record_sumit_payment'), JSON.stringify(r));
  check('★ לא נפתחה קבלה של לקוח אחר', foreignReceipts().length === 0);
  check('★ לכל היותר שליפה אחת של התשלום שנמסר (לא סריקה)', log.length <= 1 && lists().length === 0, `${log.length} פניות`);
  check('המזהה נמחק מהקישור והבעלים יודעת', rpcs.some((c) => c.fn === 'rpc_payment_link_candidate_rejected'));
}
{
  log = []; const { db } = makeDb();
  const r = await syncPaymentLink(db, provider, { ...LINK, payment_id: '5003', source: 'redirect' });
  check('★ זיוף בלי מספר לקוחה — נדחה בלי שום פנייה ל-SUMIT', r.result === 'rejected' && log.length === 0, `${log.length} פניות`);
}
{
  log = []; const { db } = makeDb();
  const r = await syncPaymentLink(db, provider, { ...LINK, payment_id: '5004', customer_candidate: '104', known_customer_id: '77', source: 'redirect' });
  check('★ מספר לקוחה שסותר את הלקוחה המאומתת — נדחה בלי שום פנייה', r.result === 'rejected' && log.length === 0, `${log.length} פניות`);
}
{
  // הלקוחה כבר מאומתת (תשלום קודם), ומזייפים מזהה תשלום של אחר עם המספר שלה.
  log = []; const { db } = makeDb();
  const r = await syncPaymentLink(db, provider, { ...LINK, payment_id: '5005', customer_candidate: '77', known_customer_id: '77', source: 'redirect' });
  check('★ תשלום של לקוח אחר מול לקוחה מאומתת — נדחה, בלי קבלה', r.result === 'rejected' && foreignReceipts().length === 0);
}

console.log('\nהוראות קבע:');
{
  log = [];
  const rpcs = [];
  const db = { rpc: async (fn, args) => { rpcs.push({ fn, args });
      if (fn === 'rpc_standing_orders_to_setup') return { data: [], error: null };
      if (fn === 'rpc_standing_orders_to_check') return { data: [{ id: 'o1', customer_id: 77, recurring_id: 1, amount: 300, date_start: '2026-10-07', last_checked_at: null, status: 'active' }], error: null };
      return { data: { ok: true, charge: { duplicate: false, valid: true } }, error: null }; },
    from: () => ({ insert: async () => ({ error: null }) }) };
  const out = await syncStandingOrders(db, standing.standingProvider());
  check('★ רק listforcustomer של הלקוחה שלנו — בלי רשימת התשלומים של החשבון', lists().length === 0 && log.every((c) => c.path === '/billing/recurring/listforcustomer/' && c.body.Customer?.ID === 77), JSON.stringify(log.map((c) => c.path)));
  check('חיוב מזוהה דרך rpc_standing_billing_observed (Date_PreviousBilling)', out.charges === 1 && rpcs.some((c) => c.fn === 'rpc_standing_billing_observed' && c.args.p_prev === '2026-10-07'));
}

console.log('\nבקוד:');
{
  const walk = (d) => readdirSync(d).flatMap((f) => { const p = `${d}/${f}`; return statSync(p).isDirectory() ? walk(p) : [p]; });
  const files = walk('supabase/functions').filter((f) => f.endsWith('.ts') && !f.includes('sumit-probe'));
  const listCallers = files.filter((f) => /payments\/list\//.test(codeOf(f)));
  check('★ שום קוד לא קורא ל-payments/list (רשימת כל התשלומים בחשבון)', listCallers.length === 0, listCallers.join(', '));
  const docLists = files.filter((f) => /documents\/list\//.test(codeOf(f)));
  check('★ שום קוד לא קורא ל-documents/list (רשימת כל הקבלות)', docLists.length === 0, docLists.join(', '));
  check('אין עוד העשרה/סריקה של מועמדים', files.every((f) => !/enrichWithDocuments|matchPayment\(/.test(codeOf(f))));
  const webhook = codeOf('supabase/functions/sumit-webhook/index.ts');
  check('★ IPN שאינו שלנו: אין פנייה ל-SUMIT', /if \(!found\?\.link\) return json\(\{ ok: true, ignored: 'not_ours' \}\);/.test(webhook)
        && webhook.indexOf("ignored: 'not_ours'") < webhook.indexOf('syncPaymentLink('));
}

console.log(fails === 0 ? '\nפרטיות SUMIT: אף תשלום או קבלה של מישהו אחר לא נפתחו' : `\n${fails} בדיקות נכשלו`);
process.exit(fails ? 1 : 0);
