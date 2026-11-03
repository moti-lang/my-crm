#!/usr/bin/env node
/**
 * ★ הנחה לתלמידה — בדפדפן אמיתי מול המסד המקומי, והזרימה האמיתית של הפונקציה
 *   (_shared/student-discount.ts); רק SUMIT מזויפת (רושמת קריאות):
 *   1. תלמידה בלי הוראת קבע: 10% → מה ישתנה (לפני שמירה) → סיבה חובה → שמירה → בכרטיס, בחוב,
 *      ובהיסטוריית ההנחות. בלי שום קריאה ל-SUMIT.
 *   2. תלמידה עם הוראת קבע פעילה: 140 ₪ על 7 חיובים → SUMIT מקבלת 80 ₪ (אותו תאריך, אותו מספר
 *      חיובים) → אצלנו 80 ₪ → ביומן הוראות הקבע: 100 ← 80.
 *   3. מנהלת סניף / רואת חשבון — אין כפתור.
 *   node supabase/tests/student-discount-ui.test.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgrestClient } from '@supabase/postgrest-js';
import { reporter, screenState, signJwt, sql, startUi } from './_ui.mjs';

const dir = mkdtempSync(join(tmpdir(), 'discount-ui-'));
const out = join(dir, 'student-discount.mjs');
execFileSync('npx', ['esbuild', 'supabase/functions/_shared/student-discount.ts', '--bundle', '--format=esm', `--outfile=${out}`, '--log-level=error']);
const { applyStudentDiscount } = await import(out);

const USERS = { owner: 'cccccccc-0000-0000-0000-000000000001', branch_manager: 'cccccccc-0000-0000-0000-000000000002', accountant: 'cccccccc-0000-0000-0000-000000000003' };
const ESTI = 'dddddddd-0000-0000-0000-000000000003', SHIRA = 'dddddddd-0000-0000-0000-000000000001', BEITAR = 'bbbbbbbb-0000-0000-0000-000000000001';
const LINK = 'eeeeeeee-0000-0000-0000-0000000007a1', ORDER = 'eeeeeeee-0000-0000-0000-0000000007b1', RECURRING = 9701, CUSTOMER = 9700;
const NAMES = { esti: sql(`select full_name from students where id = '${ESTI}'`), shira: sql(`select full_name from students where id = '${SHIRA}'`) };
const OWNER_NAME = sql(`select full_name from profiles where id = '${USERS.owner}'`);
const cleanup = () => sql(`
  delete from standing_order_events where standing_order_id = '${ORDER}';
  delete from audit_log where row_id = '${ORDER}' or (action = 'discount_change' and row_id in ('${ESTI}', '${SHIRA}'));
  delete from standing_orders where id = '${ORDER}';
  delete from payment_links where id = '${LINK}';
  update students set discount = 0, discount_reason = null where id in ('${ESTI}', '${SHIRA}')`);
cleanup();
const NEXT = sql(`select (f_today_il() + 10)::text`);
sql(`insert into payment_links (id, token, external_identifier, student_id, branch_id, amount, status, paid_at)
       values ('${LINK}', repeat('7', 60) || '7a01', 'ds-ui', '${SHIRA}', '${BEITAR}', 300, 'paid', now() - interval '70 days');
     insert into standing_orders (id, student_id, branch_id, payment_link_id, sumit_customer_id, sumit_recurring_id, amount, installments, installments_total,
                                  date_start, consent_text, consented_at, status, next_billing, last_billing, charged_count, billing_day)
     values ('${ORDER}', '${SHIRA}', '${BEITAR}', '${LINK}', ${CUSTOMER}, ${RECURRING}, 100, 9, 10, f_today_il() - interval '60 days', 'אישור', now() - interval '70 days',
             'active', '${NEXT}', f_today_il() - 20, 2, extract(day from f_today_il() + 10)::int)`);
const LAST = sql(`select ('${NEXT}'::date + interval '6 months')::date::text`);

// SUMIT מזויפת: מצב ההוראה, ועדכון שנרשם ומשנה את הסכום.
const sumitCalls = [];
let price = 100;
const sumit = {
  list: async () => { sumitCalls.push({ fn: 'list' }); return [{ ID: RECURRING, Status: 0, Date_NextBilling: `${NEXT}T00:00:00+02:00`, Date_PreviousBilling: null, Date_Last: `${LAST}T00:00:00+02:00`, UnitPrice: price }]; },
  update: async (i) => { sumitCalls.push({ fn: 'update', ...i }); price = i.unitPrice ?? price; return { ok: true }; },
  create: async () => ({ ok: false, error: 'x' }), cancel: async () => ({ ok: true }),
};

const { check, failed } = reporter();
const ui = await startUi();
try {
  const service = new PostgrestClient(ui.rest, { headers: { Authorization: `Bearer ${signJwt({ role: 'service_role' })}` } });
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const ownerDb = new PostgrestClient(ui.rest, { headers: { Authorization: `Bearer ${signJwt({ sub: USERS.owner, role: 'authenticated', aud: 'authenticated', exp })}` } });
  const functions = { 'student-discount': async (body) => (await applyStudentDiscount(ownerDb, service, sumit, body, USERS.owner)).body };

  const openCard = async (page, name) => {
    await page.goto(`${ui.app}/students`);
    await page.getByText(name, { exact: true }).first().click();
    const card = page.getByRole('dialog', { name: `כרטיס התלמידה ${name}` });
    await card.waitFor({ timeout: 8000 });
    return card;
  };

  console.log('\nהנחה בלי הוראת קבע:');
  {
    const { page, log } = await ui.newPage(USERS.owner, { functions });
    const card = await openCard(page, NAMES.esti);
    await card.getByRole('button', { name: '✎ הנחה' }).click();
    const form = card.getByTestId('discount-form');
    await form.getByRole('button', { name: '%' }).click();
    await form.getByLabel('סכום ההנחה').fill('10');
    const plan = form.getByTestId('discount-plan');
    await plan.waitFor({ timeout: 8000 });
    const p = (await plan.textContent()) ?? '';
    check('★ לפני השמירה: 10% = 200 ₪, שכר הלימוד והחוב אחרי ההנחה', p.includes('ההנחה: 200 ₪ (10.0% משכר הלימוד). שכר הלימוד: 1,800 ₪ במקום 2,000 ₪.') && p.includes('החוב: 1,800 ₪.'), p);
    check('★ בלי סיבה — אין שמירה', await form.getByRole('button', { name: 'שמירת ההנחה' }).isDisabled());
    await form.getByLabel('סיבת ההנחה').fill('אחות שנייה');
    await page.waitForTimeout(300);
    await form.getByRole('button', { name: 'שמירת ההנחה' }).click();
    await card.getByRole('status').filter({ hasText: 'ההנחה נשמרה' }).waitFor({ timeout: 8000 });
    await card.getByTestId('student-discount').waitFor({ timeout: 8000 });
    check('★ בכרטיס: ההנחה והסיבה', ((await card.getByTestId('student-discount').textContent()) ?? '').includes('הנחה ₪200 · אחות שנייה'));
    check('★ החוב בכרטיס אחרי ההנחה', ((await card.textContent()) ?? '').includes('שולם ₪0 מתוך ₪1,800'));
    const hist = card.getByRole('list', { name: 'היסטוריית ההנחות' });
    await hist.waitFor({ timeout: 8000 });
    const h = (await hist.textContent()) ?? '';
    check('★ היסטוריית ההנחות: מתי, מי, מכמה לכמה, ולמה', h.includes(OWNER_NAME) && h.includes('₪0 ← ₪200') && h.includes('אחות שנייה') && /\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/.test(h), h);
    check('★ במסד: 200 ₪, הסיבה, וביומן מי שינתה', sql(`select discount || '|' || discount_reason from students where id = '${ESTI}'`) === '200.00|אחות שנייה'
          && sql(`select actor from audit_log where action = 'discount_change' and row_id = '${ESTI}'`) === `user:${USERS.owner}`);
    check('★ בלי שום קריאה ל-SUMIT', sumitCalls.length === 0);
    check('בלי שגיאות דף ובלי שאילתות שבורות', log.pageErrors.length === 0 && log.badResponses.length === 0, [...log.pageErrors, ...log.badResponses].join('\n'));
    await page.close();
  }

  console.log('\nהנחה בהוראת קבע פעילה:');
  {
    const { page, log } = await ui.newPage(USERS.owner, { functions });
    const card = await openCard(page, NAMES.shira);
    await card.getByRole('button', { name: '✎ הנחה' }).click();
    const form = card.getByTestId('discount-form');
    await form.getByLabel('סכום ההנחה').fill('140');
    const plan = form.getByTestId('discount-plan');
    await plan.waitFor({ timeout: 8000 });
    const p = (await plan.textContent()) ?? '';
    check('★ לפני השמירה: 7 חיובים של 80 ₪ במקום 100 ₪, והעדכון ב-SUMIT', p.includes('בהוראת הקבע: 7 חיובים של 80 ₪ במקום 100 ₪') && p.includes('יתעדכן ב-SUMIT'), p);
    check('עד כאן — שום קריאה ל-SUMIT', sumitCalls.length === 0);
    await form.getByLabel('סיבת ההנחה').fill('מלגה');
    await page.waitForTimeout(300);
    await form.getByRole('button', { name: 'שמירת ההנחה' }).click();
    await card.getByRole('status').filter({ hasText: 'ההנחה נשמרה' }).waitFor({ timeout: 10000 });
    const up = sumitCalls.find((c) => c.fn === 'update');
    check('★ SUMIT: בדיקה, עדכון ואימות — 80 ₪, אותו תאריך, אותו מספר חיובים, להוראה הנכונה',
      JSON.stringify(sumitCalls.map((c) => c.fn)) === '["list","update","list"]' && up?.unitPrice === 80 && up?.nextDate === NEXT && up?.remaining === 7 && up?.recurringId === RECURRING,
      JSON.stringify(sumitCalls));
    check('★ במסד: הוראת הקבע 80 ₪, ההנחה 140 ₪', sql(`select amount || '|' || (select discount from students where id = '${SHIRA}') from standing_orders where id = '${ORDER}'`) === '80.00|140.00');
    await page.goto(`${ui.app}/standing-orders`);
    const journal = page.getByRole('region', { name: 'יומן הוראות הקבע' });
    await journal.waitFor({ timeout: 8000 });
    const j = (await journal.locator('tbody tr', { hasText: NAMES.shira }).first().textContent()) ?? '';
    check('★ ביומן הוראות הקבע: שינוי סכום (הנחה), ₪100 ← ₪80, מי', j.includes('שינוי סכום (הנחה)') && j.includes('₪100') && j.includes('₪80') && j.includes(OWNER_NAME), j);
    check('בלי שגיאות דף ובלי שאילתות שבורות', log.pageErrors.length === 0 && log.badResponses.length === 0, [...log.pageErrors, ...log.badResponses].join('\n'));
    await page.close();
  }

  console.log('\nהרשאות במסך:');
  for (const role of ['branch_manager', 'accountant']) {
    const { page, log } = await ui.newPage(USERS[role]);
    await page.goto(`${ui.app}/students`);
    const st = await screenState(page);
    await page.getByText(NAMES.esti, { exact: true }).first().click();
    const card = page.getByRole('dialog', { name: `כרטיס התלמידה ${NAMES.esti}` });
    await card.waitFor({ timeout: 8000 });
    check(`★ ${role === 'branch_manager' ? 'מנהלת סניף' : 'רואת חשבון'} — אין "הנחה"`, !st.crashed && (await card.getByRole('button', { name: '✎ הנחה' }).count()) === 0);
    check(`${role}: בלי שגיאות דף`, log.pageErrors.length === 0, log.pageErrors.join('\n'));
    await page.close();
  }
} finally {
  await ui.stop();
  cleanup();
}
console.log(failed() === 0 ? '\nהנחה לתלמידה (דפדפן): הכל עבר' : `\n${failed()} בדיקות נכשלו`);
process.exit(failed() ? 1 : 0);
