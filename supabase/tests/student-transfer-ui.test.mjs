#!/usr/bin/env node
/**
 * ★ העברת תלמידה לסניף אחר (0063) — בדפדפן אמיתי מול המסד המקומי:
 *   כרטיס → "העברה לסניף אחר" → בחירת סניף → מה יקרה → אישור → הכרטיס מציג את הסניף החדש,
 *   והיסטוריית הסניפים (מי, מתי, מאיפה לאן). מנהלת הסניף הקודם — לא רואה אותה יותר, ואין לה כפתור.
 *   node supabase/tests/student-transfer-ui.test.mjs
 */
import { reporter, sql, startUi } from './_ui.mjs';

const USERS = { owner: 'cccccccc-0000-0000-0000-000000000001', branch_manager: 'cccccccc-0000-0000-0000-000000000002' };
const ESTI = 'dddddddd-0000-0000-0000-000000000003', BEITAR = 'bbbbbbbb-0000-0000-0000-000000000001', MODIIN = 'bbbbbbbb-0000-0000-0000-000000000002';
const NAME = sql(`select full_name from students where id = '${ESTI}'`);
const GROUP = sql(`select coalesce(group_name, '') from students where id = '${ESTI}'`);
const BEITAR_NAME = sql(`select name from branches where id = '${BEITAR}'`), MODIIN_NAME = sql(`select name from branches where id = '${MODIIN}'`);
const OWNER_NAME = sql(`select full_name from profiles where id = '${USERS.owner}'`);
const restore = () => sql(`update students set branch_id = '${BEITAR}', group_name = nullif('${GROUP}', '') where id = '${ESTI}';
  delete from audit_log where action = 'transfer_student' and row_id = '${ESTI}'`);
restore();

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
  console.log('\nהבעלים — העברה לסניף אחר:');
  {
    const { page, log } = await ui.newPage(USERS.owner);
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.accept(); });
    const card = await openCard(page);
    await card.getByRole('button', { name: '⇄ העברה לסניף אחר' }).click();
    const form = card.getByTestId('transfer');
    const select = form.getByLabel('סניף חדש');
    const opts = await select.locator('option').allTextContents();
    check('★ ברשימה — הסניפים האחרים, בלי הנוכחי', opts.includes(MODIIN_NAME) && !opts.includes(BEITAR_NAME), opts.join(','));
    check('בלי בחירה — אין העברה', await form.getByRole('button', { name: 'העברה' }).isDisabled());
    const text = (await form.textContent()) ?? '';
    check('★ לפני ההעברה: מה עובר ומה נשאר', text.includes(`נשארים ב${BEITAR_NAME}`) && text.includes('הוראת קבע ממשיכה') && text.includes('קישור תשלום פתוח מתבטל'), text);
    await select.selectOption(MODIIN);
    await form.getByRole('button', { name: 'העברה' }).click();
    const done = page.getByRole('status').filter({ hasText: 'הועברה' });
    await done.waitFor({ timeout: 8000 });
    check('★ אישור לפני: מאיפה לאן', dialogs.length === 1 && dialogs[0].includes(`מ${BEITAR_NAME} ל${MODIIN_NAME}`), dialogs.join(' | '));
    check('★ הודעה אחרי: הועברה מ… ל…', ((await done.textContent()) ?? '').includes(`${NAME} הועברה מ${BEITAR_NAME} ל${MODIIN_NAME}`), await done.textContent());
    check('★ במסד: בסניף החדש', sql(`select branch_id from students where id = '${ESTI}'`) === MODIIN);
    await card.getByText(MODIIN_NAME, { exact: false }).first().waitFor({ timeout: 8000 });
    const hist = card.getByRole('list', { name: 'היסטוריית הסניפים' });
    await hist.waitFor({ timeout: 8000 });
    const h = (await hist.textContent()) ?? '';
    check('★ בכרטיס — היסטוריית הסניפים: מי, מאיפה לאן', h.includes(OWNER_NAME) && h.includes(`מ${BEITAR_NAME} ל${MODIIN_NAME}`), h);
    check('בלי שגיאות דף ובלי שאילתות שבורות', log.pageErrors.length === 0 && log.badResponses.length === 0, [...log.pageErrors, ...log.badResponses].join('\n'));
    await page.close();
  }

  console.log('\nמנהלת הסניף הקודם:');
  {
    const { page, log } = await ui.newPage(USERS.branch_manager);
    await page.goto(`${ui.app}/students`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
    check('★ לא רואה את התלמידה שעברה', (await page.getByText(NAME, { exact: true }).count()) === 0);
    const other = sql(`select full_name from students where branch_id = '${BEITAR}' and deleted_at is null order by full_name limit 1`);
    await page.getByText(other, { exact: true }).first().click();
    const card = page.getByRole('dialog', { name: `כרטיס התלמידה ${other}` });
    await card.waitFor({ timeout: 8000 });
    check('★ אין לה כפתור העברה', (await card.getByRole('button', { name: '⇄ העברה לסניף אחר' }).count()) === 0);
    check('בלי שגיאות דף', log.pageErrors.length === 0, log.pageErrors.join('\n'));
    await page.close();
  }
} finally {
  await ui.stop();
  restore();
}
console.log(failed() === 0 ? '\nהעברה לסניף אחר (דפדפן): הכל עבר' : `\n${failed()} בדיקות נכשלו`);
process.exit(failed() === 0 ? 0 : 1);
