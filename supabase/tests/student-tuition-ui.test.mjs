#!/usr/bin/env node
/**
 * ★ שינוי מחיר ידני (0064) — בדפדפן אמיתי מול המסד המקומי. המקרה של 23/11: 1,200 → 3,000,
 *   שולמו 540, ובהוראת הקבע נשארו 3 × 220. כרטיס → "שינוי מחיר" → מה ישתנה → אישור → המחיר החדש,
 *   החוב, וההיסטוריה. הוראת הקבע לא משתנה. מנהלת סניף — אין כפתור.
 *   node supabase/tests/student-tuition-ui.test.mjs
 */
import { reporter, sql, startUi } from './_ui.mjs';

const USERS = { owner: 'cccccccc-0000-0000-0000-000000000001', branch_manager: 'cccccccc-0000-0000-0000-000000000002' };
const ST = 'dddddddd-0000-0000-0000-000000000420', LINK = 'eeeeeeee-0000-0000-0000-000000000421', ORDER = 'eeeeeeee-0000-0000-0000-000000000422';
const BEITAR = 'bbbbbbbb-0000-0000-0000-000000000001', NAME = 'בדיקת מחירון';
const OWNER_NAME = sql(`select full_name from profiles where id = '${USERS.owner}'`);
const cleanup = () => sql(`
  delete from standing_orders where id = '${ORDER}';
  delete from payments where student_id = '${ST}';
  delete from payment_links where student_id = '${ST}';
  delete from audit_log where row_id = '${ST}';
  delete from students where id = '${ST}'`);
cleanup();
sql(`insert into students (id, season_id, branch_id, full_name, status, tuition_total, registration_fee, discount, parent_phone, payment_track)
     select '${ST}', season_id, '${BEITAR}', '${NAME}', 'active', 1100, 100, 0, '972521009998',
            '{"key": "so5", "total": 1200, "method": "standing_order", "first_charge": 320, "installments": 5, "first_installment": 220, "installment_amount": 220}'::jsonb
       from students where id = 'dddddddd-0000-0000-0000-000000000001';
     insert into payment_links (id, token, external_identifier, student_id, branch_id, amount, purpose, status, paid_at)
     values ('${LINK}', repeat('5', 60) || '0421', 'tc-ui', '${ST}', '${BEITAR}', 320, 'enrollment', 'paid', now() - interval '40 days');
     insert into payments (student_id, branch_id, paid_on, amount, method, source) values
       ('${ST}', '${BEITAR}', current_date - 40, 320, 'credit', 'sumit'), ('${ST}', '${BEITAR}', current_date - 9, 220, 'credit', 'sumit');
     insert into standing_orders (id, student_id, branch_id, payment_link_id, sumit_customer_id, sumit_recurring_id, amount, installments,
                                  installments_total, date_start, consent_text, consented_at, status, next_billing, charged_count)
     values ('${ORDER}', '${ST}', '${BEITAR}', '${LINK}', 1, 2, 220, 4, 5, current_date - 9, 'אישור', now() - interval '40 days', 'active', current_date + 21, 1)`);

const { check, failed } = reporter();
const ui = await startUi();
const openCard = async (page) => {
  await page.goto(`${ui.app}/students`);
  await page.getByText(NAME, { exact: true }).first().click();
  const card = page.getByRole('dialog', { name: `כרטיס התלמידה ${NAME}` });
  await card.waitFor({ timeout: 8000 });
  return card;
};
try {
  console.log('\nהבעלים — שינוי מחיר:');
  {
    const { page, log } = await ui.newPage(USERS.owner);
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.accept(); });
    const card = await openCard(page);
    await card.getByRole('button', { name: '✎ שינוי מחיר' }).click();
    const form = card.getByTestId('tuition-form');
    const input = form.getByLabel('מחיר שנתי');
    check('הטופס נפתח עם המחיר הנוכחי (כולל דמי רישום)', (await input.inputValue()) === '1200');
    await input.fill('3000');
    await form.getByLabel('סיבת שינוי המחיר').fill('נרשמה בטעות בסניף אחר');
    const plan = form.getByTestId('tuition-plan');
    await plan.waitFor({ timeout: 8000 });
    const t = (await plan.textContent()) ?? '';
    check('★ לפני השמירה: המחיר, מה נשאר, ההוראה כמו שאושרה, וההפרש כחוב', t.includes('3,000 ₪ במקום 1,200 ₪') && t.includes('נשאר לשלם: 2,460 ₪')
          && t.includes('3 × 220 ₪') && t.includes('ההפרש — 1,800 ₪'), t);
    await form.getByRole('button', { name: 'שמירת המחיר' }).click();
    const done = page.getByRole('status').filter({ hasText: 'המחיר עודכן' });
    await done.waitFor({ timeout: 8000 });
    check('★ אישור לפני השמירה', dialogs.length === 1 && dialogs[0].includes('3,000'), dialogs.join(' | '));
    check('★ הודעה אחרי: המחיר החדש ומה נשאר', ((await done.textContent()) ?? '').includes('2,460'), await done.textContent());
    check('★ במסד: 2,900 + 100 רישום; ההוראה — 220, בלי שינוי', sql(`select tuition_total || '|' || (select amount from standing_orders where id = '${ORDER}') from students where id = '${ST}'`) === '2900.00|220.00');
    const hist = card.getByRole('list', { name: 'היסטוריית המחיר' });
    await hist.waitFor({ timeout: 8000 });
    const h = (await hist.textContent()) ?? '';
    check('★ בכרטיס — היסטוריית המחיר: מי, מכמה לכמה, ולמה', h.includes(OWNER_NAME) && h.includes('3,000') && h.includes('1,200') && h.includes('נרשמה בטעות בסניף אחר'), h);
    check('בלי שגיאות דף ובלי שאילתות שבורות', log.pageErrors.length === 0 && log.badResponses.length === 0, [...log.pageErrors, ...log.badResponses].join('\n'));
    await page.close();
  }

  console.log('\nמנהלת סניף:');
  {
    const { page, log } = await ui.newPage(USERS.branch_manager);
    const card = await openCard(page);
    await card.getByText('מצב תשלומים').first().waitFor({ timeout: 8000 });
    check('★ אין כפתור "שינוי מחיר"', (await card.getByRole('button', { name: '✎ שינוי מחיר' }).count()) === 0);
    check('בלי שגיאות דף', log.pageErrors.length === 0, log.pageErrors.join('\n'));
    await page.close();
  }
} finally {
  await ui.stop();
  cleanup();
}
console.log(failed() === 0 ? '\nשינוי מחיר (דפדפן): הכל עבר' : `\n${failed()} בדיקות נכשלו`);
process.exit(failed() === 0 ? 0 : 1);
