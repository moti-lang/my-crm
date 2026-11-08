#!/usr/bin/env node
/**
 * ★ ניסיון חיוב חוזר — בדפדפן אמיתי מול המסד המקומי, והזרימה האמיתית של הפונקציה
 *   (_shared/standing-retry.ts); רק SUMIT מזויפת (רושמת קריאות):
 *   1. הוראה ש-SUMIT השביתה אחרי חיוב שנכשל: "ניסיון חיוב חוזר" → התוכנית במילים → אישור →
 *      SUMIT: בדיקה, חיוב אחד, הוראה חדשה → "החיוב עבר… ההוראה חודשה" → במסד: פעילה, המזהה החדש,
 *      תשלום, יומן.
 *   2. החיוב נדחה: הסיבה מחברת האשראי במסך, שום דבר לא חודש.
 *   3. מנהלת סניף — אין כפתור.
 *   node supabase/tests/standing-retry-ui.test.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgrestClient } from '@supabase/postgrest-js';
import { reporter, signJwt, sql, startUi } from './_ui.mjs';

const dir = mkdtempSync(join(tmpdir(), 'retry-ui-'));
const out = join(dir, 'standing-retry.mjs');
execFileSync('npx', ['esbuild', 'supabase/functions/_shared/standing-retry.ts', '--bundle', '--format=esm', `--outfile=${out}`, '--log-level=error']);
const { retryStanding } = await import(out);

const USERS = { owner: 'cccccccc-0000-0000-0000-000000000001', branch_manager: 'cccccccc-0000-0000-0000-000000000002' };
const SHIRA = 'dddddddd-0000-0000-0000-000000000001', BEITAR = 'bbbbbbbb-0000-0000-0000-000000000001';
const LINK = 'eeeeeeee-0000-0000-0000-0000000008a1', ORDER = 'eeeeeeee-0000-0000-0000-0000000008b1', RECURRING = 9811, CUSTOMER = 9810, NEW_RECURRING = 9899;
const NAME = sql(`select full_name from students where id = '${SHIRA}'`);
const cleanup = () => sql(`
  delete from standing_order_events where standing_order_id = '${ORDER}';
  delete from standing_order_charges where standing_order_id = '${ORDER}';
  delete from payments where student_id = '${SHIRA}' and note like '%חיוב חוזר%';
  delete from audit_log where row_id = '${ORDER}';
  delete from standing_orders where id = '${ORDER}';
  delete from payment_links where id = '${LINK}'`);
cleanup();
// הוראה שהושבתה: 10 תשלומים (9 בהוראה), 2 חויבו, החיוב של לפני יומיים נכשל.
const failed = () => sql(`
  update standing_orders set status = 'failed', sumit_status = 3, sumit_recurring_id = ${RECURRING}, needs_renewal = false, charged_count = 2,
         failed_count = 0, next_billing = f_today_il() - 2, last_error = null where id = '${ORDER}'`);
sql(`insert into payment_links (id, token, external_identifier, student_id, branch_id, amount, status, paid_at)
       values ('${LINK}', repeat('8', 60) || '8a01', 'rt-ui', '${SHIRA}', '${BEITAR}', 300, 'paid', now() - interval '100 days');
     insert into standing_orders (id, student_id, branch_id, payment_link_id, sumit_customer_id, sumit_recurring_id, amount, installments, installments_total,
                                  date_start, consent_text, consented_at, status, sumit_status, next_billing, charged_count, billing_day)
     values ('${ORDER}', '${SHIRA}', '${BEITAR}', '${LINK}', ${CUSTOMER}, ${RECURRING}, 100, 9, 10, f_today_il() - 62, 'אישור', now() - interval '100 days',
             'failed', 3, f_today_il() - 2, 2, least(extract(day from f_today_il() - 2)::int, 28))`);
failed();
const PLAN = JSON.parse(sql(`select f_standing_retry_plan('${ORDER}', f_today_il())::text`));
const ddmmyyyy = (d) => d.split('-').reverse().join('/');

// SUMIT מזויפת: ההוראה מושבתת (3) עד שנוצרת חדשה; החיוב — לפי מה שהבדיקה קובעת.
const sumitCalls = [];
let chargeResult = { ok: true, dryRun: true, payment: { ID: 77001, Amount: 100, Date: new Date().toISOString(), ValidPayment: true, StatusDescription: ' (קוד 000)' } };
const sumit = {
  list: async () => { sumitCalls.push({ fn: 'list' }); return [{ ID: RECURRING, Status: 3, Date_NextBilling: null, Date_PreviousBilling: null, Date_Last: null }]; },
  chargeOnce: async (i) => { sumitCalls.push({ fn: 'chargeOnce', ...i }); return chargeResult; },
  create: async (i) => { sumitCalls.push({ fn: 'create', ...i }); return { ok: true, recurringId: NEW_RECURRING, immediatePayment: null, dryRun: true }; },
  update: async () => ({ ok: true }), cancel: async () => ({ ok: true }),
};

const { check, failed: failedCount } = reporter();
const ui = await startUi();
try {
  const service = new PostgrestClient(ui.rest, { headers: { Authorization: `Bearer ${signJwt({ role: 'service_role' })}` } });
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const ownerDb = new PostgrestClient(ui.rest, { headers: { Authorization: `Bearer ${signJwt({ sub: USERS.owner, role: 'authenticated', aud: 'authenticated', exp })}` } });
  const functions = { 'standing-order-retry': async (body) => (await retryStanding(ownerDb, service, sumit, body, USERS.owner)).body };
  const openCard = async (page) => {
    await page.goto(`${ui.app}/students`);
    await page.getByText(NAME, { exact: true }).first().click();
    const card = page.getByRole('dialog', { name: `כרטיס התלמידה ${NAME}` });
    await card.waitFor({ timeout: 8000 });
    return card;
  };

  console.log('\nהחיוב עבר — ההוראה מחודשת:');
  {
    const { page, log } = await ui.newPage(USERS.owner, { functions });
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.accept(); });
    const card = await openCard(page);
    await card.getByRole('button', { name: 'ניסיון חיוב חוזר' }).click();
    const plan = card.getByTestId('retry-plan');
    await plan.waitFor({ timeout: 8000 });
    const p = (await plan.textContent()) ?? '';
    check('★ לפני הלחיצה — במילים: כמה, על איזה חיוב, מה יקרה אם יעבור ואם לא',
          p.includes('ננסה לחייב עכשיו 100 ₪ בכרטיס השמור של ההורה') && p.includes(`ההוראה תחודש ב-SUMIT: 6 חיובים של 100 ₪, מ-${ddmmyyyy(PLAN.next).slice(0, 5)}`) && p.includes('אם לא יעבור'), p);
    check('עד כאן — שום קריאה ל-SUMIT', sumitCalls.length === 0);
    await card.getByRole('button', { name: 'לחייב עכשיו ₪100' }).click();
    await card.getByRole('status').filter({ hasText: 'החיוב עבר' }).waitFor({ timeout: 10000 });
    check('★ אישור לפני חיוב אמיתי', dialogs.length === 1 && dialogs[0].includes('לחייב עכשיו ₪100 בכרטיס השמור'), dialogs.join(' | '));
    const done = (await card.getByRole('status').filter({ hasText: 'החיוב עבר' }).textContent()) ?? '';
    check('★ במסך: החיוב עבר, וההוראה חודשה — כמה ומתי', done.includes('✓ החיוב עבר (₪100).') && done.includes(`ההוראה חודשה ב-SUMIT: 6 חיובים מ-${ddmmyyyy(PLAN.next)}`), done);
    check('★ SUMIT: בדיקה, חיוב אחד (100 ₪, ללקוחה שלנו), הוראה חדשה ל-6 חיובים מהתאריך בתוכנית',
          JSON.stringify(sumitCalls.map((c) => c.fn)) === '["list","chargeOnce","create"]' && sumitCalls[1].amount === 100 && sumitCalls[1].customerId === CUSTOMER
          && sumitCalls[2].installments === 6 && sumitCalls[2].dateStart === PLAN.next, JSON.stringify(sumitCalls));
    check('★ במסד: פעילה, המזהה החדש, חיוב 4 מתוך 10, בלי "צריך לחדש"',
          sql(`select status || '|' || sumit_recurring_id || '|' || charged_count || '|' || needs_renewal from standing_orders where id = '${ORDER}'`) === `active|${NEW_RECURRING}|3|false`);
    check('★ התשלום בכרטיס התלמידה', sql(`select count(*) || '|' || sum(amount) from payments where student_id = '${SHIRA}' and note like '%חיוב חוזר%'`) === '1|100.00');
    const events = card.getByRole('list', { name: 'יומן ההוראה' });
    await events.getByText('הוראה חודשה ב-SUMIT', { exact: false }).waitFor({ timeout: 8000 });
    const ev = (await events.textContent()) ?? '';
    check('★ ביומן ההוראה: חיוב חוזר (עבר) והוראה חודשה', ev.includes('(חיוב חוזר)') && ev.includes('₪100 — עבר') && ev.includes('(הוראה חודשה ב-SUMIT)') && ev.includes('6 חיובים'), ev);
    check('בלי שגיאות דף ובלי שאילתות שבורות', log.pageErrors.length === 0 && log.badResponses.length === 0, [...log.pageErrors, ...log.badResponses].join('\n'));
    await page.close();
  }

  console.log('\nהחיוב נדחה:');
  {
    failed(); sumitCalls.length = 0;
    chargeResult = { ok: true, dryRun: true, payment: { ID: 77002, Amount: 100, Date: new Date().toISOString(), ValidPayment: false, StatusDescription: ' סירוב (קוד 004)' } };
    const { page, log } = await ui.newPage(USERS.owner, { functions });
    page.on('dialog', (d) => void d.accept());
    const card = await openCard(page);
    await card.getByRole('button', { name: 'ניסיון חיוב חוזר' }).click();
    await card.getByTestId('retry-plan').waitFor({ timeout: 8000 });
    await card.getByRole('button', { name: 'לחייב עכשיו ₪100' }).click();
    const alert = card.getByRole('alert').filter({ hasText: 'דחתה' });
    await alert.waitFor({ timeout: 10000 });
    const a = (await alert.textContent()) ?? '';
    check('★ במסך: חברת האשראי דחתה, והסיבה', a.includes('חברת האשראי דחתה את החיוב') && a.includes('סירוב (קוד 004)'), a);
    check('★ לא נוצרה הוראה חדשה', !sumitCalls.some((c) => c.fn === 'create'));
    check('★ במסד: עדיין מושבתת, ניסיון שנדחה נספר, הסיבה', sql(`select status || '|' || failed_count || '|' || last_error from standing_orders where id = '${ORDER}'`) === 'failed|1|ניסיון חוזר נדחה: סירוב (קוד 004)');
    check('בלי שגיאות דף', log.pageErrors.length === 0, log.pageErrors.join('\n'));
    await page.close();
  }

  console.log('\nהרשאות במסך:');
  {
    const { page, log } = await ui.newPage(USERS.branch_manager);
    const card = await openCard(page);
    await card.getByText('חיוב 3 מתוך 10', { exact: false }).first().waitFor({ timeout: 8000 });
    check('★ מנהלת סניף — אין "ניסיון חיוב חוזר"', (await card.getByRole('button', { name: 'ניסיון חיוב חוזר' }).count()) === 0);
    check('בלי שגיאות דף', log.pageErrors.length === 0, log.pageErrors.join('\n'));
    await page.close();
  }
} finally {
  await ui.stop();
  cleanup();
}
console.log(failedCount() === 0 ? '\nניסיון חיוב חוזר (דפדפן): הכל עבר' : `\n${failedCount()} בדיקות נכשלו`);
process.exit(failedCount() ? 1 : 0);
