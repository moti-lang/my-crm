#!/usr/bin/env node
/**
 * ★ 0058 — תלמידה שנוספה ידנית כ"פעילה" במסלול הוראת קבע ולא שילמה כלום (אושרת ראובן, 15/11):
 *   בכרטיס — "🔁 קישור הרשמה חדש" עם הסבר (התשלום הראשון + יום חיוב + הוראת קבע), בלי "קישור תשלום"
 *   רגיל על כל הסכום. לחיצה → קישור על התשלום הראשון בלבד, והקישור הרגיל הפתוח מתבטל.
 *   ופעילה ששילמה משהו — "קישור תשלום" רגיל כמו קודם.
 *   node supabase/tests/standing-link-active-ui.test.mjs
 */
import { reporter, sql, startUi } from './_ui.mjs';

const OWNER = 'cccccccc-0000-0000-0000-000000000001';
const BEITAR = 'bbbbbbbb-0000-0000-0000-000000000001';
const LAST = 'פעילהידנית';
const cleanup = () => sql(`
  delete from audit_log where row_id in (select id from students where last_name = '${LAST}') or (action = 'renew_enrollment_link' and after ->> 'student' in (select id::text from students where last_name = '${LAST}'));
  delete from payment_links where student_id in (select id from students where last_name = '${LAST}');
  delete from reminders where student_id in (select id from students where last_name = '${LAST}');
  delete from payments where student_id in (select id from students where last_name = '${LAST}');
  delete from students where last_name = '${LAST}';
  update settings set value = 'false'::jsonb where key = 'standing_orders_enabled'`);
cleanup();
sql(`update settings set value = 'true'::jsonb where key = 'standing_orders_enabled'`);
// כמו מהמסך "הוספת תלמידה": פעילה, מסלול הוראת קבע 10 תשלומים.
const add = (first, phone) => sql(`select set_config('request.jwt.claims', '{"sub":"${OWNER}","role":"authenticated"}', false);
  set role authenticated;
  select rpc_create_student('{"branch_id":"${BEITAR}","first_name":"${first}","last_name":"${LAST}","parent_phone":"${phone}","status":"active","track":"so10"}'::jsonb)::text;
  reset role;`);
add('אושרת', '0521117001');
add('שילמה', '0521117002');
const OSHRAT = sql(`select id from students where first_name = 'אושרת' and last_name = '${LAST}'`);
const PAID = sql(`select id from students where first_name = 'שילמה' and last_name = '${LAST}'`);
const FIRST_CHARGE = Number(sql(`select payment_track ->> 'first_charge' from students where id = '${OSHRAT}'`));
// כמו שקרה: נשלח לה קודם קישור רגיל על כל הסכום (לפני 0058). נבדוק שהוא מתבטל.
sql(`insert into payment_links (token, external_identifier, student_id, branch_id, amount, purpose, status)
     select repeat('f', 60) || 'sla1', 'tl-sla-debt', id, branch_id, tuition_total, 'debt', 'opened' from students where id = '${OSHRAT}'`);
sql(`insert into payments (student_id, branch_id, paid_on, amount, method, source, note)
     select id, branch_id, current_date, 50, 'cash', 'manual', 'בדיקה' from students where id = '${PAID}'`);

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

  console.log('\nפעילה, הוראת קבע, לא שילמה:');
  {
    const { page, log } = await ui.newPage(OWNER);
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.accept(); });
    const card = await openCard(page, `אושרת ${LAST}`);
    const renew = card.getByRole('button', { name: '🔁 קישור הרשמה חדש' });
    await renew.waitFor({ timeout: 8000 });
    check('★ בכרטיס: "קישור הרשמה חדש"', await renew.isVisible());
    check('★ ...בלי "קישור תשלום" רגיל על כל הסכום', (await card.getByRole('button', { name: /קישור תשלום/ }).count()) === 0);
    const note = (await card.getByTestId('renew-note').textContent()) ?? '';
    check('★ הסבר: התשלום הראשון, יום חיוב, הוראת קבע — לא חיוב אחד', note.includes('הוראת קבע') && note.includes('יום חיוב') && note.includes('לא חיוב אחד על כל הסכום'), note);
    await renew.click();
    await card.getByText('הקישור', { exact: false }).first().waitFor({ timeout: 8000 });
    check('אישור לפני השליחה, עם הסבר על הוראת הקבע', dialogs.length === 1 && dialogs[0].includes('הוראת הקבע'), dialogs.join(' | '));
    const live = sql(`select purpose || '|' || amount from payment_links where student_id = '${OSHRAT}' and status in ('pending', 'opened')`);
    check('★ במסד: קישור הרשמה על התשלום הראשון בלבד', live === `enrollment|${FIRST_CHARGE.toFixed(2)}`, live);
    check('★ הקישור הרגיל על כל הסכום — בוטל', sql(`select status from payment_links where external_identifier = 'tl-sla-debt'`) === 'cancelled');
    check('בלי שגיאות דף ובלי שאילתות שבורות', log.pageErrors.length === 0 && log.badResponses.length === 0, [...log.pageErrors, ...log.badResponses].join('\n'));
    await page.close();
  }

  console.log('\nפעילה ששילמה משהו — כמו קודם:');
  {
    const { page, log } = await ui.newPage(OWNER);
    const card = await openCard(page, `שילמה ${LAST}`);
    await card.getByRole('button', { name: /קישור תשלום/ }).waitFor({ timeout: 8000 });
    check('"קישור תשלום" רגיל', await card.getByRole('button', { name: /קישור תשלום/ }).isVisible());
    check('...בלי "קישור הרשמה חדש"', (await card.getByRole('button', { name: '🔁 קישור הרשמה חדש' }).count()) === 0);
    check('בלי שגיאות דף', log.pageErrors.length === 0, log.pageErrors.join('\n'));
    await page.close();
  }
} finally {
  await ui.stop();
  cleanup();
}
console.log(failed() === 0 ? '\nקישור הוראת קבע לפעילה (דפדפן): הכל עבר' : `\n${failed()} בדיקות נכשלו`);
process.exit(failed() ? 1 : 0);
