#!/usr/bin/env node
/**
 * ★ עריכת שם תלמידה — בדפדפן אמיתי מול המסד המקומי:
 *   כרטיס → "עריכת שם" → שמירה → השם החדש בכרטיס, ברשימת התלמידות, במסך הגבייה ובדף הנוכחות
 *   של האחראית; בכרטיס: היסטוריית השם (מי, מתי, ממה למה). שם פגום / כפול — הודעה, בלי שינוי.
 *   מנהלת הסניף — יכולה; רואת חשבון — אין כפתור.
 *   node supabase/tests/student-rename-ui.test.mjs
 */
import { reporter, screenState, sql, startUi } from './_ui.mjs';

const USERS = { owner: 'cccccccc-0000-0000-0000-000000000001', branch_manager: 'cccccccc-0000-0000-0000-000000000002', accountant: 'cccccccc-0000-0000-0000-000000000003' };
const ESTI = 'dddddddd-0000-0000-0000-000000000003', BEITAR = 'bbbbbbbb-0000-0000-0000-000000000001';
const ORIGINAL = sql(`select full_name || '|' || coalesce(first_name, '') || '|' || coalesce(last_name, '') from students where id = '${ESTI}'`).split('|');
const OLD = ORIGINAL[0];                        // "אסתי וייס"
const NEW = 'אסתר וייס-כץ';
const OTHER = sql(`select full_name from students where branch_id = '${BEITAR}' and id <> '${ESTI}' and deleted_at is null and cancelled_at is null
                   and season_id = (select season_id from students where id = '${ESTI}') order by full_name limit 1`);
const OWNER_NAME = sql(`select full_name from profiles where id = '${USERS.owner}'`);
const restore = () => sql(`update students set full_name = '${ORIGINAL[0]}', first_name = nullif('${ORIGINAL[1]}', ''), last_name = nullif('${ORIGINAL[2]}', '') where id = '${ESTI}';
  delete from audit_log where action = 'rename_student' and row_id = '${ESTI}'`);
restore();

const { check, failed } = reporter();
const ui = await startUi();
try {
  console.log('\nהבעלים — עריכת שם בכרטיס:');
  {
    const { page, log } = await ui.newPage(USERS.owner);
    await page.goto(`${ui.app}/students`);
    await page.getByText(OLD, { exact: true }).first().click();
    const card = page.getByRole('dialog', { name: `כרטיס התלמידה ${OLD}` });
    await card.waitFor({ timeout: 8000 });
    await card.getByRole('button', { name: 'עריכת שם התלמידה' }).click();
    const first = card.getByLabel('שם פרטי'), last = card.getByLabel('שם משפחה');
    check('הטופס נפתח עם השם הנוכחי (פרטי + משפחה)', `${await first.inputValue()} ${await last.inputValue()}` === OLD);
    await first.fill('אסתר1');
    check('★ ספרות בשם — הודעה, והשמירה חסומה', (await card.getByRole('alert').textContent())?.includes('אותיות בלבד') && await card.getByRole('button', { name: 'שמירה' }).isDisabled());
    // ★ כפילות: שם של תלמידה אחרת בסניף — המסד מסרב, השם לא משתנה.
    await first.fill(OTHER.split(' ')[0]);
    await last.fill(OTHER.split(' ').slice(1).join(' '));
    await card.getByRole('button', { name: 'שמירה' }).click();
    await page.waitForTimeout(800);
    check(`★ שם של תלמידה אחרת בסניף ("${OTHER}") — נדחה, עם הסבר`, (await card.getByRole('alert').textContent())?.includes('כבר יש בסניף תלמידה בשם')
          && sql(`select full_name from students where id = '${ESTI}'`) === OLD);
    await first.fill('אסתר');
    await last.fill('וייס-כץ');
    await card.getByRole('button', { name: 'שמירה' }).click();
    const done = page.getByRole('status').filter({ hasText: 'השם עודכן' });
    await done.waitFor({ timeout: 8000 });
    check('★ אחרי השמירה — הודעה: מאיזה שם לאיזה, בכל המסכים', (await done.textContent())?.includes(`מ-„${OLD}” ל-„${NEW}” בכל המסכים`), await done.textContent());
    const card2 = page.getByRole('dialog', { name: `כרטיס התלמידה ${NEW}` });
    await card2.waitFor({ timeout: 8000 });
    check('★ הכרטיס מציג את השם החדש', (await card2.locator('h2').textContent())?.trim() === NEW);
    const hist = card2.getByRole('list', { name: 'היסטוריית השם' });
    await hist.waitFor({ timeout: 8000 });
    const h = (await hist.textContent()) ?? '';
    check('★ בכרטיס — היסטוריית השם: מתי, מי, ממה למה', h.includes(OWNER_NAME) && h.includes(`מ-„${OLD}” ל-„${NEW}”`) && /\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/.test(h), h);
    await card2.getByRole('button', { name: 'סגירה' }).click();
    await page.waitForTimeout(500);
    check('★ רשימת התלמידות — השם החדש, בלי הישן', (await page.getByText(NEW, { exact: true }).count()) > 0 && (await page.getByText(OLD, { exact: true }).count()) === 0);
    await page.goto(`${ui.app}/collection`);
    await page.waitForLoadState('networkidle');
    await page.getByText(NEW, { exact: true }).first().waitFor({ timeout: 8000 }).catch(() => undefined);
    check('★ מסך הגבייה — השם החדש, בלי הישן', (await page.getByText(NEW, { exact: true }).count()) > 0 && (await page.getByText(OLD, { exact: true }).count()) === 0);
    check('★ ביומן במסד: מי שינתה, ממה ולמה', sql(`select actor || '|' || (before ->> 'full_name') || '|' || (after ->> 'full_name') from audit_log where action = 'rename_student' and row_id = '${ESTI}'`)
          === `user:${USERS.owner}|${OLD}|${NEW}`);
    // הסירוב לשם הכפול הוא התשובה הצפויה מהמסד (400 עם ההסבר) — לא שאילתה שבורה.
    const bad = log.badResponses.filter((b) => !(b.includes('rpc_rename_student') && b.includes('כבר יש בסניף תלמידה בשם')));
    check('בלי שגיאות דף ובלי שאילתות שבורות (מלבד הסירוב הצפוי לשם הכפול)', log.pageErrors.length === 0 && bad.length === 0, [...log.pageErrors, ...bad].join('\n'));
    await page.close();
  }

  console.log('\nדף הנוכחות של האחראית:');
  {
    const token = sql(`select token from attendance_links where branch_id = '${BEITAR}' and is_active limit 1`);
    const { page, log } = await ui.newPage(null);
    await page.goto(`${ui.app}/a/${token}`);
    await page.getByText(NEW, { exact: true }).first().waitFor({ timeout: 8000 }).catch(() => undefined);
    check('★ השם החדש בגיליון הנוכחות, בלי הישן', (await page.getByText(NEW, { exact: true }).count()) === 1 && (await page.getByText(OLD, { exact: true }).count()) === 0);
    check('בלי שגיאות דף', log.pageErrors.length === 0, log.pageErrors.join('\n'));
    await page.close();
  }

  console.log('\nהרשאות במסך:');
  for (const [role, expect] of [['branch_manager', 1], ['accountant', 0]]) {
    const { page, log } = await ui.newPage(USERS[role]);
    await page.goto(`${ui.app}/students`);
    const st = await screenState(page);
    await page.getByText(NEW, { exact: true }).first().click();
    const card = page.getByRole('dialog', { name: `כרטיס התלמידה ${NEW}` });
    await card.waitFor({ timeout: 8000 });
    const n = await card.getByRole('button', { name: 'עריכת שם התלמידה' }).count();
    check(role === 'branch_manager' ? 'מנהלת הסניף — יש "עריכת שם"' : '★ רואת חשבון — אין "עריכת שם"', !st.crashed && n === expect);
    check(`${role}: בלי שגיאות דף`, log.pageErrors.length === 0, log.pageErrors.join('\n'));
    await page.close();
  }
} finally {
  await ui.stop();
  restore();
}
console.log(failed() === 0 ? '\nעריכת שם תלמידה (דפדפן): הכל עבר' : `\n${failed()} בדיקות נכשלו`);
process.exit(failed() ? 1 : 0);
