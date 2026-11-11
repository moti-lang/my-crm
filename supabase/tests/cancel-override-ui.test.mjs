#!/usr/bin/env node
/**
 * ★ ביטול הרשמה חריג לתקנון — בדפדפן אמיתי מול המסד המקומי:
 *   1. חודש הניסיון הסתיים: "ביטול הרשמה" אפור, ולבעלים "ביטול בכל זאת (חריג לתקנון)" → סכום החזר
 *      (לא יותר ממה ששולם) + סיבה (חובה) → אישור → "ההרשמה בוטלה", החזר, תזכורת ל-SUMIT.
 *   2. מנהלת סניף — אין.
 *   node supabase/tests/cancel-override-ui.test.mjs
 */
import { reporter, sql, startUi } from './_ui.mjs';

const USERS = { owner: 'cccccccc-0000-0000-0000-000000000001', branch_manager: 'cccccccc-0000-0000-0000-000000000002' };
const BEITAR = 'bbbbbbbb-0000-0000-0000-000000000001';
const FIRST = 'שוהם', LAST = 'חריגה';
const cleanup = () => sql(`
  delete from audit_log where row_id in (select id from students where last_name = '${LAST}');
  delete from reminders where student_id in (select id from students where last_name = '${LAST}');
  delete from payment_links where student_id in (select id from students where last_name = '${LAST}');
  delete from payments where student_id in (select id from students where last_name = '${LAST}');
  delete from students where last_name = '${LAST}';
  delete from enrollment_requests where ip = '27.0.0.1'`);
cleanup();
sql(`select rpc_enroll(jsonb_build_object('first_name', '${FIRST}', 'last_name', '${LAST}', 'grade', 'ה', 'school', 'בית יעקב',
  'phone', '0521114321', 'email', 'co-ui@example.com', 'enroll_token', (select enroll_token from branches where id = '${BEITAR}'),
  'terms_accepted', true, 'track', 'card1', 'whatsapp', 'yes', 'photo', 'yes'), '27.0.0.1')`);
const STUDENT = sql(`select id from students where last_name = '${LAST}'`);
const NAME = `${FIRST} ${LAST}`;
sql(`update students set trial_started_on = current_date - 40 where id = '${STUDENT}';
     insert into payments (student_id, branch_id, paid_on, amount, method, source, note)
     select id, branch_id, current_date - 30, 1200, 'credit', 'sumit', 'בדיקה' from students where id = '${STUDENT}'`);

const { check, failed } = reporter();
const ui = await startUi();
try {
  const openCard = async (page) => {
    await page.goto(`${ui.app}/students`);
    await page.getByText(NAME, { exact: true }).first().click();
    const card = page.getByRole('dialog', { name: `כרטיס התלמידה ${NAME}` });
    await card.waitFor({ timeout: 8000 });
    return card;
  };

  console.log('\nאחרי חודש הניסיון — חריג לתקנון:');
  {
    const { page, log } = await ui.newPage(USERS.owner);
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.accept(); });
    const card = await openCard(page);
    check('הביטול הרגיל — אפור (לפי התקנון)', await card.getByRole('button', { name: 'ביטול הרשמה', exact: true }).isDisabled());
    await card.getByRole('button', { name: 'ביטול בכל זאת (חריג לתקנון)' }).click();
    const form = card.getByTestId('cancel-override');
    check('★ בטופס: כתוב שזה חריג לתקנון ושיירשם ביומן', ((await form.textContent()) ?? '').includes('זה חריג, ויירשם ביומן עם הסיבה'));
    const amount = form.getByLabel('סכום ההחזר');
    check('ברירת המחדל: בלי החזר (0)', (await amount.inputValue()) === '0');
    await amount.fill('1300');
    check('★ יותר ממה ששולם — אין ביטול, עם הסבר', await form.getByRole('button', { name: 'ביטול ההרשמה' }).isDisabled() && ((await form.textContent()) ?? '').includes('יותר ממה ששולם'));
    await amount.fill('700');
    check('★ בלי סיבה — אין ביטול', await form.getByRole('button', { name: 'ביטול ההרשמה' }).isDisabled());
    await form.getByLabel('סיבת הביטול החריג').fill('מעבר דירה');
    await form.getByRole('button', { name: 'ביטול ההרשמה' }).click();
    await card.getByTestId('override-result').waitFor({ timeout: 8000 });
    check('★ אישור לפני הביטול: חריג, וכמה מוחזר', dialogs.length === 1 && dialogs[0].includes('חריג לתקנון') && dialogs[0].includes('₪700'), dialogs.join(' | '));
    const res = (await card.getByTestId('override-result').textContent()) ?? '';
    check('★ התוצאה: בוטלה, החזר של ₪700, ולהחזיר ב-SUMIT', res.includes('ההרשמה בוטלה (חריג לתקנון)') && res.includes('₪700') && res.includes('SUMIT'), res);
    check('★ במסד: הפסיקה, החזר 700, שורת החזר', sql(`select status || '|' || refund_amount || '|' || (select sum(amount) from payments where student_id = '${STUDENT}' and amount < 0) from students where id = '${STUDENT}'`) === 'stopped|700.00|-700.00');
    check('בלי שגיאות דף ובלי שאילתות שבורות', log.pageErrors.length === 0 && log.badResponses.length === 0, [...log.pageErrors, ...log.badResponses].join('\n'));
    await page.close();
  }

  console.log('\nהרשאות במסך:');
  {
    sql(`update students set status = 'active', cancelled_at = null, refund_amount = null where id = '${STUDENT}'`);
    const { page, log } = await ui.newPage(USERS.branch_manager);
    const card = await openCard(page);
    await card.getByText('חודש ניסיון', { exact: false }).first().waitFor({ timeout: 8000 });
    check('★ מנהלת סניף — אין "ביטול בכל זאת"', (await card.getByRole('button', { name: 'ביטול בכל זאת (חריג לתקנון)' }).count()) === 0);
    check('בלי שגיאות דף', log.pageErrors.length === 0, log.pageErrors.join('\n'));
    await page.close();
  }
} finally {
  await ui.stop();
  cleanup();
}
console.log(failed() === 0 ? '\nביטול הרשמה חריג (דפדפן): הכל עבר' : `\n${failed()} בדיקות נכשלו`);
process.exit(failed() ? 1 : 0);
