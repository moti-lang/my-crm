#!/usr/bin/env node
/**
 * ★ כרטיס התלמידה — בדפדפן אמיתי מול המסד המקומי:
 *   · "חיבור הוראת קבע שנפתחה ב-SUMIT": מספר לקוח → ההוראות שלו → בחירה → כמה תשלומים → "בוצעו 3 מתוך
 *     10" → חיבור → ההוראה מופיעה בכרטיס ("חיוב 3 מתוך 10"). SUMIT מזויפת; החיבור עצמו — ה-RPC האמיתי.
 *   · הערות: עריכה ושמירה. מנהלת סניף — יכולה; רואת חשבון — אין כפתור עריכה ואין כפתור חיבור.
 *   node supabase/tests/standing-link-ui.test.mjs
 */
import { reporter, sql, startUi } from './_ui.mjs';

const USERS = { owner: 'cccccccc-0000-0000-0000-000000000001', branch_manager: 'cccccccc-0000-0000-0000-000000000002', accountant: 'cccccccc-0000-0000-0000-000000000003' };
const SHIRA = 'dddddddd-0000-0000-0000-000000000001', CUSTOMER = 9990002, REC = 5550002;
const NAME = sql(`select full_name from students where id = '${SHIRA}'`);
const NOTES = sql(`select coalesce(notes, '') from students where id = '${SHIRA}'`);
const cleanup = () => sql(`
  delete from standing_order_events where standing_order_id in (select id from standing_orders where sumit_recurring_id = ${REC});
  delete from audit_log where action in ('standing_link_external', 'student_notes') and (row_id in (select id from standing_orders where sumit_recurring_id = ${REC}) or row_id = '${SHIRA}');
  delete from standing_orders where sumit_recurring_id = ${REC};
  update students set notes = nullif('${NOTES.replace(/'/g, "''")}', '') where id = '${SHIRA}'`);
cleanup();
const live = Number(sql(`select count(*) from standing_orders where student_id = '${SHIRA}' and status not in ('cancelled', 'completed')`));
if (live) { console.error('לתלמידת הבדיקה יש הוראה חיה בזרע — הבדיקה לא תקפה'); process.exit(1); }

const day = (offset, months = 0) => sql(`select ((current_date + ${offset}) + interval '${months} months')::date`);
const ITEMS = [
  { id: REC, status: 0, statusLabel: 'פעילה', amount: 210, next: day(10), prev: day(-21), last: day(10, 6), remaining: 7, linkable: true, reason: null },
  { id: 5550003, status: 1, statusLabel: 'בוטלה', amount: 210, next: null, prev: null, last: day(10, 6), remaining: null, linkable: false, reason: 'ההוראה בוטלה ב-SUMIT' },
];
const calls = [];
const functions = {
  'standing-order-link': (body) => {
    calls.push(body);
    if (body.action === 'list') return { ok: true, items: ITEMS };
    const it = ITEMS.find((i) => i.id === body.recurring_id);
    return JSON.parse(sql(`select rpc_standing_link_external('${SHIRA}', ${body.customer_id}, ${it.id}, ${it.amount}, ${body.total}, ${it.status},
      '${it.next}', '${it.prev}', '${it.last}', '${USERS.owner}')::text`));
  },
};

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
  console.log('\nחיבור הוראת קבע מ-SUMIT (בעלים):');
  {
    const { page, log } = await ui.newPage(USERS.owner, { functions });
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.accept(); });
    const card = await openCard(page);
    await card.getByRole('button', { name: 'חיבור הוראת קבע שנפתחה ב-SUMIT' }).click();
    const box = card.getByTestId('sumit-link');
    await box.getByLabel('מספר הלקוח ב-SUMIT').fill(String(CUSTOMER));
    await box.getByRole('button', { name: 'חיפוש ב-SUMIT' }).click();
    const list = box.getByRole('list', { name: 'הוראות הקבע ב-SUMIT' });
    await list.waitFor({ timeout: 8000 });
    const t = (await list.textContent()) ?? '';
    check('★ ההוראות של הלקוח: הסכום, המצב, וכמה נותרו', t.includes('210') && t.includes('פעילה') && t.includes('נותרו 7'), t);
    check('★ הוראה שבוטלה — מוצגת עם הסיבה, ואי אפשר לבחור', t.includes('ההוראה בוטלה ב-SUMIT') && await box.getByLabel('הוראה 5550003').isDisabled());
    await box.getByLabel(`הוראה ${REC}`).check();
    await box.getByLabel('מספר התשלומים בהוראה').fill('5');
    check('פחות ממה שנותר לפי SUMIT — שגיאה, ואי אפשר לחבר', (await box.getByRole('alert').count()) === 1 && await box.getByRole('button', { name: 'חיבור' }).isDisabled());
    await box.getByLabel('מספר התשלומים בהוראה').fill('10');
    const plan = (await box.getByTestId('sumit-link-plan').textContent()) ?? '';
    check('★ לפני החיבור: "בוצעו 3 מתוך 10", ואזהרה לא לרשום ידנית', plan.includes('בוצעו 3 מתוך 10') && plan.includes('לא לרשום אותם ידנית'), plan);
    await box.getByRole('button', { name: 'חיבור' }).click();
    await card.getByRole('status').filter({ hasText: 'חוברה' }).waitFor({ timeout: 8000 });
    check('★ אישור לפני החיבור', dialogs.length === 1 && dialogs[0].includes(NAME));
    check('★ נשלח: לקוח, הוראה, 10 — בלי סכום מהדפדפן', JSON.stringify(calls.at(-1)) === JSON.stringify({ action: 'link', student: SHIRA, customer_id: CUSTOMER, recurring_id: REC, total: 10 }), JSON.stringify(calls.at(-1)));
    await card.getByText('חיוב 3 מתוך 10', { exact: false }).first().waitFor({ timeout: 8000 });
    check('★ ההוראה בכרטיס: "חיוב 3 מתוך 10"', (await card.getByText('חיוב 3 מתוך 10', { exact: false }).count()) > 0);
    check('אחרי החיבור — אין שוב כפתור חיבור', (await card.getByRole('button', { name: 'חיבור הוראת קבע שנפתחה ב-SUMIT' }).count()) === 0);
    check('בלי שגיאות דף ובלי שאילתות שבורות', log.pageErrors.length === 0 && log.badResponses.length === 0, [...log.pageErrors, ...log.badResponses].join('\n'));
    await page.close();
  }

  console.log('\nהערות:');
  {
    const { page, log } = await ui.newPage(USERS.branch_manager);
    const card = await openCard(page);
    await card.getByRole('button', { name: '✎ עריכת הערות' }).click();
    await card.getByLabel('הערות לתלמידה').fill('ההורה משלם בהוראת קבע שנפתחה ב-SUMIT');
    await card.getByRole('button', { name: 'שמירה' }).click();
    await card.getByTestId('student-notes').waitFor({ timeout: 8000 });
    check('★ מנהלת סניף: ההערה נשמרה ומוצגת', ((await card.getByTestId('student-notes').textContent()) ?? '') === 'ההורה משלם בהוראת קבע שנפתחה ב-SUMIT'
          && sql(`select notes from students where id = '${SHIRA}'`) === 'ההורה משלם בהוראת קבע שנפתחה ב-SUMIT');
    check('★ מנהלת סניף — אין כפתור חיבור הוראה מ-SUMIT', (await card.getByRole('button', { name: 'חיבור הוראת קבע שנפתחה ב-SUMIT' }).count()) === 0);
    check('בלי שגיאות דף', log.pageErrors.length === 0 && log.badResponses.length === 0, [...log.pageErrors, ...log.badResponses].join('\n'));
    await page.close();
  }
  {
    const { page } = await ui.newPage(USERS.accountant);
    const card = await openCard(page);
    await card.getByTestId('student-notes').waitFor({ timeout: 8000 }).catch(() => undefined);
    check('★ רואת חשבון: רואה את ההערה, בלי עריכה', (await card.getByText('ההורה משלם בהוראת קבע שנפתחה ב-SUMIT').count()) === 1
          && (await card.getByRole('button', { name: '✎ עריכת הערות' }).count()) === 0);
    await page.close();
  }
} finally {
  await ui.stop();
  cleanup();
}
console.log(failed() === 0 ? '\nחיבור הוראה מ-SUMIT והערות (דפדפן): הכל עבר' : `\n${failed()} בדיקות נכשלו`);
process.exit(failed() === 0 ? 0 : 1);
