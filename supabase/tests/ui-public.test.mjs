// ui-public.test.mjs — הדפים שהורים ומורות רואים, בדפדפן אמיתי, בלי התחברות.
// דף ההרשמה, דף התשלום ודף הנוכחות: נטענים, מציגים את התוכן האמיתי (סניף,
// תקנון, סכום), ולא קורסים גם מול קישור שגוי.
import { reporter, screenState, sql, startUi } from './_ui.mjs';

const ENROLL = sql(`select name || '|' || enroll_token from branches where is_active and deleted_at is null and enroll_token is not null order by name limit 1`).split('|');
const [BRANCH_NAME, ENROLL_TOKEN] = ENROLL;
// קישור תשלום ודף נוכחות — נוצרים לבדיקה ונמחקים בסוף.
const STUDENT = sql(`select s.id || '|' || s.branch_id from students s where s.deleted_at is null and s.status = 'active' order by s.full_name limit 1`).split('|');
const PAY_TOKEN = 'ui' + 'f'.repeat(62);
const ATT_TOKEN = 'uiatt' + '0'.repeat(27);
sql(`delete from payment_links where token = '${PAY_TOKEN}'; delete from attendance_links where token = '${ATT_TOKEN}'`);
sql(`insert into payment_links (token, external_identifier, student_id, branch_id, amount) values ('${PAY_TOKEN}', 'ui-test-pay', '${STUDENT[0]}', '${STUDENT[1]}', 137)`);
sql(`insert into attendance_links (branch_id, token) values ('${STUDENT[1]}', '${ATT_TOKEN}')`);

const { check, failed } = reporter();
const ui = await startUi();
try {
  const { page, log } = await ui.newPage(null);
  async function visit(label, path, expect) {
    log.pageErrors.length = 0; log.badResponses.length = 0;
    await page.goto(`${ui.app}${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);
    const s = await screenState(page);
    const missing = [];
    for (const text of expect) if ((await page.getByText(text, { exact: false }).count()) === 0) missing.push(text);
    const problems = [
      s.crashed && `קריסה:\n${s.details}`,
      ...log.pageErrors.map((e) => `JS: ${e}`),
      ...log.badResponses.map((r) => `שאילתה נדחתה: ${r}`),
      ...missing.map((t) => `לא הוצג: "${t}"`),
    ].filter(Boolean);
    check(label, problems.length === 0, problems.join('\n'));
  }

  console.log('\n  ── דף ההרשמה ──');
  await visit(`★ /enroll/<טוקן> — הרשמה ל${BRANCH_NAME}: שם הסניף, שדות והתקנון`, `/enroll/${ENROLL_TOKEN}`, [`הרשמה · ${BRANCH_NAME}`, 'שם פרטי', 'תקנון']);
  await visit('/enroll בלי טוקן — לא קורס', '/enroll', []);
  await visit('/enroll/<טוקן שגוי> — הודעה, לא קריסה', '/enroll/not-a-real-token', []);

  console.log('\n  ── דף התשלום ──');
  await visit('★ /pay/<טוקן> — כותרת וסכום', `/pay/${PAY_TOKEN}`, ['תשלום שכר לימוד', '137']);
  await visit('/pay/<טוקן שגוי> — הודעה, לא קריסה', '/pay/not-a-real-token', []);

  console.log('\n  ── דף הנוכחות (מורות) ──');
  await visit('/a/<טוקן> — נטען', `/a/${ATT_TOKEN}`, []);
  await page.close();
} finally {
  await ui.stop();
  sql(`delete from payment_links where token = '${PAY_TOKEN}'; delete from attendance_links where token = '${ATT_TOKEN}'`);
}

if (failed()) { console.log(`\n  ✗ ${failed()} בדיקות דפים ציבוריים נכשלו`); process.exit(1); }
console.log('\n  כל הדפים הציבוריים נטענו');
