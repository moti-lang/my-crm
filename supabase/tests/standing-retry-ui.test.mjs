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
  with d as (delete from payment_links where replaces_standing_order_id = '${ORDER}' returning reminder_id)
  delete from reminders where id in (select reminder_id from d);
  delete from standing_order_events where standing_order_id = '${ORDER}';
  delete from standing_order_charges where standing_order_id = '${ORDER}';
  delete from payments where student_id = '${SHIRA}' and (note like '%חיוב חוזר%' or note like '%שולם בנפרד%');
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
let listStatus = 3, listNext = null;   // ★ 0060: "חיוב חוזר" ב-SUMIT מחזיר את ההוראה לפעילה (0)
let chargeResult = { ok: true, dryRun: true, payment: { ID: 77001, Amount: 100, Date: new Date().toISOString(), ValidPayment: true, StatusDescription: ' (קוד 000)' } };
const sumit = {
  list: async () => { sumitCalls.push({ fn: 'list' }); return [{ ID: RECURRING, Status: listStatus, Date_NextBilling: listNext, Date_PreviousBilling: null, Date_Last: null }]; },
  chargeOnce: async (i) => { sumitCalls.push({ fn: 'chargeOnce', ...i }); return chargeResult; },
  create: async (i) => { sumitCalls.push({ fn: 'create', ...i }); return { ok: true, recurringId: NEW_RECURRING, immediatePayment: null, dryRun: true }; },
  update: async () => ({ ok: true }), cancel: async (cid, rid) => { sumitCalls.push({ fn: 'cancel', customerId: cid, recurringId: rid }); return { ok: true }; },
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
    check('★ SUMIT: בדיקה, חיוב אחד (100 ₪, ללקוחה שלנו), הוראה חדשה ל-6 חיובים מהתאריך בתוכנית, וביטול הישנה',
          JSON.stringify(sumitCalls.map((c) => c.fn)) === '["list","chargeOnce","create","cancel"]' && sumitCalls[1].amount === 100 && sumitCalls[1].customerId === CUSTOMER
          && sumitCalls[2].installments === 6 && sumitCalls[2].dateStart === PLAN.next
          && sumitCalls[3].customerId === CUSTOMER && sumitCalls[3].recurringId === RECURRING, JSON.stringify(sumitCalls));
    check('★ במסך: "ההוראה הישנה (החסומה) בוטלה ב-SUMIT"', done.includes('ההוראה הישנה (החסומה) בוטלה ב-SUMIT'), done);
    check('★ במסד: פעילה, המזהה החדש, חיוב 4 מתוך 10, בלי "צריך לחדש"',
          sql(`select status || '|' || sumit_recurring_id || '|' || charged_count || '|' || needs_renewal from standing_orders where id = '${ORDER}'`) === `active|${NEW_RECURRING}|3|false`);
    check('★ התשלום בכרטיס התלמידה', sql(`select count(*) || '|' || sum(amount) from payments where student_id = '${SHIRA}' and note like '%חיוב חוזר%'`) === '1|100.00');
    const events = card.getByRole('list', { name: 'יומן ההוראה' });
    await events.getByText('הוראה חודשה ב-SUMIT', { exact: false }).waitFor({ timeout: 8000 });
    const ev = (await events.textContent()) ?? '';
    check('★ ביומן ההוראה: חיוב חוזר (עבר) והוראה חודשה', ev.includes('(חיוב חוזר)') && ev.includes('₪100 — עבר') && ev.includes('(הוראה חודשה ב-SUMIT)') && ev.includes('6 חיובים'), ev);
    const lastOk = (await card.getByTestId('last-retry').textContent()) ?? '';
    check('★ "ניסיון חיוב חוזר אחרון": ✓ עבר, והסכום', lastOk.includes('ניסיון חיוב חוזר אחרון') && lastOk.includes('✓ עבר') && lastOk.includes('₪100'), lastOk);
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

  console.log('\nפעילה שוב ב-SUMIT (הניסו "חיוב חוזר" שם קודם):');
  {
    failed(); sumitCalls.length = 0; listStatus = 0;
    const paidBefore = sql(`select count(*) from payments where student_id = '${SHIRA}' and note like '%חיוב חוזר%'`); listNext = new Date(Date.now() + 2 * 86400e3).toISOString().slice(0, 10) + 'T00:00:00+02:00';
    const { page, log } = await ui.newPage(USERS.owner, { functions });
    page.on('dialog', (d) => void d.accept());
    const card = await openCard(page);
    await card.getByRole('button', { name: 'ניסיון חיוב חוזר' }).click();
    await card.getByTestId('retry-plan').waitFor({ timeout: 8000 });
    await card.getByRole('button', { name: 'לחייב עכשיו ₪100' }).click();
    const last = card.getByTestId('last-retry');
    await last.filter({ hasText: 'לא בוצע' }).waitFor({ timeout: 10000 });
    const t = (await last.textContent()) ?? '';
    check('★ במסך: "ניסיון חיוב חוזר אחרון — לא בוצע", ולמה', t.includes('לא בוצע') && t.includes('לא חויב') && t.includes('פעילה (קוד 0)'), t);
    check('★ ההוראה במסך — "פעילה" (המצב מ-SUMIT נקלט מיד, בלי לחכות לסנכרון)', ((await card.textContent()) ?? '').includes('פעילה')
          && (await card.getByRole('button', { name: 'ניסיון חיוב חוזר' }).count()) === 0);
    check('★ לא חויב: אין חיוב ב-SUMIT ואין תשלום', !sumitCalls.some((c) => c.fn === 'chargeOnce')
          && sql(`select count(*) from payments where student_id = '${SHIRA}' and note like '%חיוב חוזר%'`) === paidBefore);
    check('★ במסד: פעילה, קוד 0, וביומן "לא בוצע"', sql(`select status || '|' || sumit_status from standing_orders where id = '${ORDER}'`) === 'active|0'
          && sql(`select count(*) from standing_order_events where standing_order_id = '${ORDER}' and kind = 'retry_refused'`) === '1');
    check('בלי שגיאות דף', log.pageErrors.length === 0, log.pageErrors.join('\n'));
    await page.close();
    listStatus = 3; listNext = null;
    failed();   // ★ הבלוק הבא (הרשאות) בודק כפתור שמופיע רק בהוראה מושבתת
  }

  console.log('\nהחיוב שולם בנפרד (חיוב ידני ב-SUMIT) — רושמים ומחדשים, בלי לחייב:');
  {
    failed(); sumitCalls.length = 0;
    sql(`update standing_orders set sumit_recurring_id = ${RECURRING} where id = '${ORDER}'`);
    const paidBefore = Number(sql(`select count(*) from payments where student_id = '${SHIRA}' and deleted_at is null`));
    const { page, log } = await ui.newPage(USERS.owner, { functions });
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.accept(); });
    const card = await openCard(page);
    await card.getByRole('button', { name: 'החיוב שולם בנפרד' }).click();
    const form = card.getByTestId('paid-elsewhere');
    check('★ בטופס: נרשם בלי לחייב, ואחר כך חידוש בלי חיוב', ((await form.textContent()) ?? '').includes('בלי לחייב') && ((await form.textContent()) ?? '').includes('גם בלי חיוב'));
    check('בלי "איך שולם" — אין רישום', await form.getByRole('button', { name: 'לרשום, בלי לחייב' }).isDisabled());
    await form.getByLabel('איך שולם').fill('חיוב ידני בכרטיס ב-SUMIT');
    await form.getByRole('button', { name: 'לרשום, בלי לחייב' }).click();
    await card.getByTestId('retry-plan').waitFor({ timeout: 10000 });
    check('★ אישור לפני הרישום: "לא יבוצע שום חיוב"', dialogs.length === 1 && dialogs[0].includes('לא יבוצע שום חיוב'), dialogs.join(' | '));
    const plan = (await card.getByTestId('retry-plan').textContent()) ?? '';
    check('★ מיד אחרי: רק חידוש ההוראה, בלי חיוב', plan.includes('בלי חיוב נוסף') && plan.includes('בנפרד'), plan);
    check('★ התשלום נרשם בכרטיס', Number(sql(`select count(*) from payments where student_id = '${SHIRA}' and deleted_at is null`)) === paidBefore + 1
          && sql(`select count(*) from payments where student_id = '${SHIRA}' and note like '%שולם בנפרד%חיוב ידני בכרטיס ב-SUMIT'`) === '1');
    await card.getByRole('button', { name: 'לחדש את ההוראה ב-SUMIT' }).click();
    await card.getByText('ההוראה חודשה ב-SUMIT', { exact: false }).first().waitFor({ timeout: 10000 });
    check('★ ב-SUMIT: רק הוראה חדשה — בלי שום חיוב', !sumitCalls.some((c) => c.fn === 'chargeOnce') && sumitCalls.some((c) => c.fn === 'create'), JSON.stringify(sumitCalls));
    check('★ ...והישנה ("חסומה עקב אי תשלום") בוטלה ב-SUMIT', sumitCalls.some((c) => c.fn === 'cancel' && c.recurringId === RECURRING), JSON.stringify(sumitCalls));
    check('★ במסד: פעילה, המזהה החדש', sql(`select status || '|' || sumit_recurring_id || '|' || needs_renewal from standing_orders where id = '${ORDER}'`) === `active|${NEW_RECURRING}|false`);
    check('בלי שגיאות דף ובלי שאילתות שבורות', log.pageErrors.length === 0 && log.badResponses.length === 0, [...log.pageErrors, ...log.badResponses].join('\n'));
    await page.close();
    sql(`delete from payments where student_id = '${SHIRA}' and note like '%שולם בנפרד%'`);
    failed();
  }

  console.log('\nקישור להחלפת כרטיס (הכרטיס השמור לא עובר):');
  {
    failed(); sumitCalls.length = 0;
    const { page, log } = await ui.newPage(USERS.owner, { functions });
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.accept(); });
    const card = await openCard(page);
    await card.getByRole('button', { name: 'קישור להחלפת כרטיס' }).click();
    await card.getByTestId('card-link-result').waitFor({ timeout: 10000 });
    check('★ אישור לפני השליחה: הסכום, ומה ממשיך — עוד 6 חיובים מהחודש הבא', dialogs.length === 1 && dialogs[0].includes('100')
          && dialogs[0].includes('עוד 6 חיובים, מהחודש הבא') && dialogs[0].includes('ההוראה הישנה תבוטל'), dialogs.join(' | '));
    const res = (await card.getByTestId('card-link-result').textContent()) ?? '';
    const href = (await card.getByTestId('card-link-result').getByRole('link', { name: 'פתיחה' }).getAttribute('href')) ?? '';
    check('★ הקישור מוצג: העתקה ופתיחה', res.includes('העתקת קישור') && href.includes('/pay/'), `${res} | ${href}`);
    check('★ במסד: קישור על 100, ואחריו 6 חיובים — ושום פנייה ל-SUMIT', sql(`select amount || '|' || standing_installments || '|' || status from payment_links
          where replaces_standing_order_id = '${ORDER}'`) === '100.00|6|pending' && sumitCalls.length === 0, JSON.stringify(sumitCalls));
    await card.getByText('קישור להחלפת כרטיס)', { exact: false }).first().waitFor({ timeout: 8000 });
    check('ביומן ההוראה: נשלח קישור', ((await card.getByLabel('יומן ההוראה').textContent()) ?? '').includes('נשלח להורה קישור על'));
    check('בלי שגיאות דף ובלי שאילתות שבורות', log.pageErrors.length === 0 && log.badResponses.length === 0, [...log.pageErrors, ...log.badResponses].join('\n'));
    await page.close();
    sql(`with d as (delete from payment_links where replaces_standing_order_id = '${ORDER}' returning reminder_id)
         delete from reminders where id in (select reminder_id from d);
         delete from standing_order_events where standing_order_id = '${ORDER}' and kind = 'card_link'`);
    failed();
  }

  console.log('\nהרשאות במסך:');
  {
    const { page, log } = await ui.newPage(USERS.branch_manager);
    const card = await openCard(page);
    await card.getByText('חיוב 3 מתוך 10', { exact: false }).first().waitFor({ timeout: 8000 });
    check('★ מנהלת סניף — אין "ניסיון חיוב חוזר", "החיוב שולם בנפרד" או "קישור להחלפת כרטיס"', (await card.getByRole('button', { name: 'ניסיון חיוב חוזר' }).count()) === 0
          && (await card.getByRole('button', { name: 'החיוב שולם בנפרד' }).count()) === 0
          && (await card.getByRole('button', { name: 'קישור להחלפת כרטיס' }).count()) === 0);
    check('בלי שגיאות דף', log.pageErrors.length === 0, log.pageErrors.join('\n'));
    await page.close();
  }
} finally {
  await ui.stop();
  cleanup();
}
console.log(failedCount() === 0 ? '\nניסיון חיוב חוזר (דפדפן): הכל עבר' : `\n${failedCount()} בדיקות נכשלו`);
process.exit(failedCount() ? 1 : 0);
