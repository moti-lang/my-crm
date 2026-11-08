#!/usr/bin/env node
/**
 * ★ קישור הרשמה חדש וסכום חלקי — בדפדפן אמיתי מול המסד המקומי:
 *   1. גבייה ← "נרשמו ולא שילמו": תלמידה בהוראת קבע שהכרטיס שלה לא עבר והקישור פג —
 *      "🔁 קישור הרשמה חדש" (ולא "קישור תשלום" רגיל). אישור עם הסבר על הוראת הקבע → נשלח 210 ₪,
 *      קישור הרשמה חדש במסד, הישן מבוטל/פג, הודעה בתור.
 *   2. הכרטיס של אותה תלמידה: גם שם "קישור הרשמה חדש", בלי "קישור תשלום".
 *   3. תלמידה פעילה עם חוב: "💳 קישור תשלום" → סכום (ברירת מחדל: כל החוב) → 100 ₪ → אישור
 *      "מתוך חוב של" → קישור על 100 ₪. פחות מ-1 / יותר מהחוב — אין שליחה, עם הסבר.
 *   4. ★ המסך אומר את האמת על הוואטסאפ: כשאין שליחה מהמערכת / ההורה לא מקבלת וואטסאפ —
 *      "ההודעה לא נשלחה", והקישור להעתקה (נבדק שמה שהועתק הוא הקישור).
 *   5. רואת חשבון — אין כפתורים.
 *   node supabase/tests/payment-link-ui.test.mjs
 */
import { reporter, sql, startUi } from './_ui.mjs';

const USERS = { owner: 'cccccccc-0000-0000-0000-000000000001', accountant: 'cccccccc-0000-0000-0000-000000000003' };
const ESTI = 'dddddddd-0000-0000-0000-000000000003';
const BEITAR = 'bbbbbbbb-0000-0000-0000-000000000001';
const FIRST = 'גלית', LAST = 'קישורחדש';

const cleanup = () => sql(`
  delete from payment_links where student_id in (select id from students where last_name = '${LAST}') or student_id = '${ESTI}';
  delete from reminders where student_id in (select id from students where last_name = '${LAST}') or (student_id = '${ESTI}' and kind = 'payment_link');
  delete from audit_log where action = 'renew_enrollment_link' or (table_name = 'students' and row_id in (select id from students where last_name = '${LAST}'));
  delete from students where last_name = '${LAST}';
  delete from enrollment_requests where ip = '23.0.0.1';
  update settings set value = 'false'::jsonb where key = 'standing_orders_enabled'`);
cleanup();
sql(`update settings set value = 'true'::jsonb where key = 'standing_orders_enabled'`);
const enrolled = sql(`select rpc_enroll(jsonb_build_object('first_name', '${FIRST}', 'last_name', '${LAST}', 'grade', 'ד', 'school', 'בית יעקב',
  'phone', '0521119876', 'email', 'ui@example.com', 'enroll_token', (select enroll_token from branches where id = '${BEITAR}'),
  'terms_accepted', true, 'track', 'so10', 'whatsapp', 'yes', 'photo', 'yes', 'billing_day', '20'), '23.0.0.1') ->> 'ok'`);
if (enrolled !== 'true') throw new Error('ההרשמה לבדיקה נכשלה');
const STUDENT = sql(`select id from students where last_name = '${LAST}'`);
const NAME = `${FIRST} ${LAST}`;
// הכרטיס לא עבר בדף של SUMIT, והקישור פג.
sql(`update payment_links set status = 'opened', opened_at = now() - interval '8 days', expires_at = now() - interval '1 day' where student_id = '${STUDENT}'`);
const OLD_LINK = sql(`select id from payment_links where student_id = '${STUDENT}'`);
const BALANCE = Number(sql(`select (s.tuition_total - s.discount) - coalesce((select sum(amount) from payments p where p.student_id = s.id and p.deleted_at is null), 0) from students s where id = '${ESTI}'`));
const ESTI_NAME = sql(`select full_name from students where id = '${ESTI}'`);
const ESTI_WA = sql(`select coalesce(whatsapp_opt_in::text, 'null') from students where id = '${ESTI}'`);

const { check, failed } = reporter();
const ui = await startUi();
try {
  const openCard = async (page, name) => {
    await page.goto(`${ui.app}/students`);
    await page.getByText(name, { exact: true }).first().click();
    const card = page.getByRole('dialog', { name: `כרטיס התלמידה ${name}` });
    await card.waitFor({ timeout: 8000 });
    return card;
  };

  console.log('\nגבייה — נרשמו ולא שילמו:');
  {
    const { page, log } = await ui.newPage(USERS.owner);
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.accept(); });
    await page.goto(`${ui.app}/collection?view=enrolled`);
    const row = page.locator('tbody tr', { hasText: NAME });
    await row.waitFor({ timeout: 8000 });
    check('★ "קישור הרשמה חדש" — ולא "קישור תשלום" רגיל', (await row.getByRole('button', { name: '🔁 קישור הרשמה חדש' }).count()) === 1
          && (await row.getByRole('button', { name: '💳 קישור תשלום' }).count()) === 0);
    await row.getByRole('button', { name: '🔁 קישור הרשמה חדש' }).click();
    await row.getByRole('status').waitFor({ timeout: 8000 });
    check('★ לפני השליחה — אישור שמסביר: יום חיוב, אישור הוראת הקבע, הקודם מתבטל',
          dialogs.length === 1 && dialogs[0].includes('תבחר יום חיוב ותאשר את הוראת הקבע') && dialogs[0].includes('הקישור הקודם יבוטל'), dialogs.join(' | '));
    const st = (await row.getByRole('status').textContent()) ?? '';
    check('★ הקישור נוצר: 210 ₪ (החיוב הראשון במסלול)', st.includes('₪210'), st);
    check('★ לא כתוב "נשלח": שליחת וואטסאפ מהמערכת לא מופעלת — "ההודעה לא נשלחה"', st.includes('ההודעה לא נשלחה') && !st.includes('ונשלח להורה'), st);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ui.app });
    await row.getByRole('button', { name: 'העתקת קישור' }).click();
    await row.getByRole('button', { name: '✓ הועתק' }).waitFor({ timeout: 5000 });
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    const url = await row.getByLabel('הקישור').inputValue();
    check('★ "העתקת קישור" מעתיק את הקישור לדף התשלום', copied === url && /\/pay\/[0-9a-f]{64}$/.test(url), `${copied} | ${url}`);
    const live = sql(`select purpose || '|' || amount || '|' || status from payment_links where student_id = '${STUDENT}' and id <> '${OLD_LINK}'`);
    check('★ במסד: קישור הרשמה (לא חוב) על 210 ₪, ממתין', live === 'enrollment|210.00|pending', live);
    check('הקישור הישן לא חי', sql(`select f_payment_link_alive(l) from payment_links l where id = '${OLD_LINK}'`) === 'f');
    check('★ הודעה להורה בתור', sql(`select count(*) from reminders where student_id = '${STUDENT}' and body like '%קישור חדש להשלמת ההרשמה%'`) === '1');
    check('בלי שגיאות דף ובלי שאילתות שבורות', log.pageErrors.length === 0 && log.badResponses.length === 0, [...log.pageErrors, ...log.badResponses].join('\n'));
    await page.close();
  }

  console.log('\nהכרטיס של תלמידה שממתינה לחיוב הראשון:');
  {
    const { page, log } = await ui.newPage(USERS.owner);
    const card = await openCard(page, NAME);
    await card.getByRole('button', { name: '🔁 קישור הרשמה חדש' }).waitFor({ timeout: 8000 });
    check('★ בכרטיס: "קישור הרשמה חדש", בלי "קישור תשלום"', (await card.getByRole('button', { name: '💳 קישור תשלום' }).count()) === 0);
    check('בלי שגיאות דף', log.pageErrors.length === 0 && log.badResponses.length === 0, [...log.pageErrors, ...log.badResponses].join('\n'));
    await page.close();
  }

  console.log('\nסכום חלקי (100 ₪ בכרטיס, השאר במזומן):');
  {
    const { page, log } = await ui.newPage(USERS.owner);
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.accept(); });
    sql(`update students set whatsapp_opt_in = false where id = '${ESTI}'`);
    const card = await openCard(page, ESTI_NAME);
    await card.getByRole('button', { name: '💳 קישור תשלום' }).click();
    const form = card.getByTestId('payment-link-form');
    const amount = form.getByLabel('סכום לקישור');
    check('★ ברירת המחדל: כל החוב', Number(await amount.inputValue()) === BALANCE, `${await amount.inputValue()} / ${BALANCE}`);
    await amount.fill('0');
    check('★ 0 — אין שליחה, "לפחות 1 ₪"', await form.getByRole('button', { name: 'יצירת קישור' }).isDisabled() && ((await form.textContent()) ?? '').includes('לפחות 1 ₪'));
    await amount.fill(String(BALANCE + 1));
    check('★ יותר מהחוב — אין שליחה, עם הסבר', await form.getByRole('button', { name: 'יצירת קישור' }).isDisabled() && ((await form.textContent()) ?? '').includes('יותר מהחוב הפתוח'));
    await amount.fill('100');
    check('100 — "חלק מהחוב", אפשר לשלוח', !(await form.getByRole('button', { name: 'יצירת קישור' }).isDisabled()) && ((await form.textContent()) ?? '').includes('חלק מהחוב'));
    await form.getByRole('button', { name: 'יצירת קישור' }).click();
    await card.getByTestId('link-result').waitFor({ timeout: 8000 });
    check('★ האישור: 100 ₪ מתוך החוב', dialogs.length === 1 && dialogs[0].includes('₪100') && dialogs[0].includes('מתוך חוב של'), dialogs.join(' | '));
    check('★ במסד: קישור חוב על 100 ₪', sql(`select purpose || '|' || amount from payment_links where student_id = '${ESTI}' and status = 'pending'`) === 'debt|100.00');
    const res = (await card.getByTestId('link-result').textContent()) ?? '';
    check('★ הקישור נוצר: ₪100', res.includes('הקישור נוצר (₪100)'), res);
    check('★ ההורה לא מקבלת וואטסאפ — כתוב, ואפשר להעתיק', res.includes('ההורה לא מקבלת וואטסאפ') && res.includes('העתקת קישור'), res);
    check('בלי שגיאות דף ובלי שאילתות שבורות', log.pageErrors.length === 0 && log.badResponses.length === 0, [...log.pageErrors, ...log.badResponses].join('\n'));
    await page.close();
  }

  console.log('\nהרשאות במסך:');
  {
    const { page, log } = await ui.newPage(USERS.accountant);
    await page.goto(`${ui.app}/collection?view=enrolled`);
    const row = page.locator('tbody tr', { hasText: NAME });
    await row.waitFor({ timeout: 8000 });
    check('★ רואת חשבון — אין "קישור הרשמה חדש"', (await row.getByRole('button').count()) === 0);
    check('בלי שגיאות דף', log.pageErrors.length === 0, log.pageErrors.join('\n'));
    await page.close();
  }
} finally {
  await ui.stop();
  cleanup();
  sql(`update students set whatsapp_opt_in = ${ESTI_WA} where id = '${ESTI}'`);
}
console.log(failed() === 0 ? '\nקישור הרשמה חדש וסכום חלקי (דפדפן): הכל עבר' : `\n${failed()} בדיקות נכשלו`);
process.exit(failed() ? 1 : 0);
