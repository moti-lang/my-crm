#!/usr/bin/env node
/**
 * ★ ביטול תשלום — בדפדפן אמיתי מול המסד המקומי:
 *   1. "הוחזר להורה": "ביטול" ליד התשלום → סוג + סיבה (חובה) → אישור → שורת החזר ברשימה,
 *      התשלום המקורי מסומן "הוחזר", החוב חזר, ובהיסטוריה: מי, כמה, למה.
 *   2. "נרשם בטעות": התשלום יוצא מהרשימה, החוב חזר, ובהיסטוריה.
 *   3. מנהלת סניף — אין "ביטול".
 *   node supabase/tests/payment-void-ui.test.mjs
 */
import { reporter, sql, startUi } from './_ui.mjs';

const USERS = { owner: 'cccccccc-0000-0000-0000-000000000001', branch_manager: 'cccccccc-0000-0000-0000-000000000002' };
const ESTI = 'dddddddd-0000-0000-0000-000000000003';
const NAME = sql(`select full_name from students where id = '${ESTI}'`);
const OWNER_NAME = sql(`select full_name from profiles where id = '${USERS.owner}'`);
const cleanup = () => sql(`
  delete from audit_log where action = 'void_payment' and after ->> 'student' = '${ESTI}';
  delete from payments where student_id = '${ESTI}' and refund_of is not null;
  delete from payments where student_id = '${ESTI}' and note = 'בדיקת ביטול'`);
cleanup();
const pay = (amount, method) => sql(`insert into payments (student_id, branch_id, paid_on, amount, method, source, note)
  select id, branch_id, current_date - 2, ${amount}, '${method}', 'manual', 'בדיקת ביטול' from students where id = '${ESTI}' returning id`).split('\n')[0];
const P500 = pay(500, 'cash'), P200 = pay(200, 'transfer');
const balance = () => Number(sql(`select (s.tuition_total - s.discount) - coalesce((select sum(amount) from payments p where p.student_id = s.id and p.deleted_at is null), 0) from students s where id = '${ESTI}'`));
const START = balance();

const { check, failed } = reporter();
const ui = await startUi();
try {
  const openCard = async (page) => {
    await page.goto(`${ui.app}/students`);
    await page.getByText(NAME, { exact: true }).first().click();
    const card = page.getByRole('dialog', { name: `כרטיס התלמידה ${NAME}` });
    await card.waitFor({ timeout: 8000 });
    await card.getByRole('list', { name: 'תשלומים', exact: true }).waitFor({ timeout: 8000 });
    return card;
  };
  const row = (card, amount) => card.getByRole('list', { name: 'תשלומים', exact: true }).locator('li', { hasText: `₪${amount}` }).first();

  console.log('\nהוחזר להורה:');
  {
    const { page, log } = await ui.newPage(USERS.owner);
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.accept(); });
    const card = await openCard(page);
    await row(card, 500).getByRole('button', { name: 'ביטול' }).click();
    const form = card.getByTestId('void-form');
    check('★ בלי סוג ובלי סיבה — אין ביטול', await form.getByRole('button', { name: 'ביטול התשלום' }).isDisabled());
    await form.getByLabel('הוחזר להורה', { exact: false }).check();
    check('★ סוג בלי סיבה — עדיין אין ביטול', await form.getByRole('button', { name: 'ביטול התשלום' }).isDisabled());
    await form.getByLabel('סיבת הביטול').fill('כפל תשלום');
    await form.getByRole('button', { name: 'ביטול התשלום' }).click();
    await card.getByTestId('void-result').waitFor({ timeout: 8000 });
    check('★ אישור לפני הרישום', dialogs.length === 1 && dialogs[0].includes('לרשום החזר של ₪500'), dialogs.join(' | '));
    const res = (await card.getByTestId('void-result').textContent()) ?? '';
    check('★ התוצאה: נרשם החזר, והחוב עכשיו', res.includes('✓ נרשם החזר של ₪500.') && res.includes('החוב עכשיו'), res);
    const list = (await card.getByRole('list', { name: 'תשלומים', exact: true }).textContent()) ?? '';
    check('★ ברשימה: שורת החזר, והתשלום המקורי "הוחזר"', list.includes('החזר') && list.includes('הוחזר') && list.includes('כפל תשלום'), list);
    check('★ במסד: החוב חזר (+500)', balance() === START + 500, `${balance()} / ${START + 500}`);
    const hist = card.getByRole('list', { name: 'תשלומים שבוטלו' });
    await hist.waitFor({ timeout: 8000 });
    const h = (await hist.textContent()) ?? '';
    check('★ בהיסטוריה: מי, הוחזר להורה, כמה, למה', h.includes(OWNER_NAME) && h.includes('הוחזר להורה') && h.includes('₪500') && h.includes('כפל תשלום'), h);
    check('על התשלום שהוחזר — אין שוב "ביטול"', (await row(card, 500).getByRole('button', { name: 'ביטול' }).count()) === 0);
    check('בלי שגיאות דף ובלי שאילתות שבורות', log.pageErrors.length === 0 && log.badResponses.length === 0, [...log.pageErrors, ...log.badResponses].join('\n'));
    await page.close();
  }

  console.log('\nנרשם בטעות:');
  {
    const { page, log } = await ui.newPage(USERS.owner);
    page.on('dialog', (d) => void d.accept());
    const card = await openCard(page);
    await row(card, 200).getByRole('button', { name: 'ביטול' }).click();
    const form = card.getByTestId('void-form');
    await form.getByLabel('נרשם בטעות', { exact: false }).check();
    await form.getByLabel('סיבת הביטול').fill('הוקלד לתלמידה הלא נכונה');
    await form.getByRole('button', { name: 'ביטול התשלום' }).click();
    await card.getByTestId('void-result').waitFor({ timeout: 8000 });
    const res = (await card.getByTestId('void-result').textContent()) ?? '';
    check('★ התוצאה: התשלום נמחק', res.includes('✓ התשלום של ₪200 נמחק.'), res);
    await page.waitForTimeout(500);
    check('★ התשלום יצא מהרשימה', sql(`select deleted_at is not null from payments where id = '${P200}'`) === 't'
          && (await card.getByRole('list', { name: 'תשלומים', exact: true }).locator('li', { hasText: '₪200' }).count()) === 0);
    check('★ במסד: החוב חזר (+700 בסך הכל)', balance() === START + 700);
    const h = (await card.getByRole('list', { name: 'תשלומים שבוטלו' }).textContent()) ?? '';
    check('★ בהיסטוריה: בוטל (נרשם בטעות), והסיבה', h.includes('בוטל (נרשם בטעות)') && h.includes('הוקלד לתלמידה הלא נכונה'), h);
    check('בלי שגיאות דף ובלי שאילתות שבורות', log.pageErrors.length === 0 && log.badResponses.length === 0, [...log.pageErrors, ...log.badResponses].join('\n'));
    await page.close();
  }

  console.log('\nהרשאות במסך:');
  {
    const P300 = pay(300, 'cash');
    const { page, log } = await ui.newPage(USERS.branch_manager);
    const card = await openCard(page);
    await row(card, 300).waitFor({ timeout: 8000 });
    check('★ מנהלת סניף — אין "ביטול"', (await card.getByRole('list', { name: 'תשלומים', exact: true }).getByRole('button', { name: 'ביטול' }).count()) === 0);
    check('בלי שגיאות דף', log.pageErrors.length === 0, log.pageErrors.join('\n'));
    await page.close();
    void P300;
  }
} finally {
  await ui.stop();
  cleanup();
}
void P500;
console.log(failed() === 0 ? '\nביטול תשלום (דפדפן): הכל עבר' : `\n${failed()} בדיקות נכשלו`);
process.exit(failed() ? 1 : 0);
