// ui-screens.test.mjs — כל מסך במערכת נטען בדפדפן אמיתי, לכל תפקיד.
// לכל מסך: אין מסך קריסה, אין "לא הצלחנו לטעון", אין שגיאת JavaScript,
// אין שאילתה שה-PostgREST האמיתי דחה (4xx/5xx), והכותרת הנכונה מוצגת.
// הנתונים: המסד המקומי של הבדיקות (סניפים, תלמידות, תשלומים, הפקות אמיתיים).
import { reporter, screenState, sql, startUi } from './_ui.mjs';

const USERS = {
  owner: 'cccccccc-0000-0000-0000-000000000001',
  branch_manager: 'cccccccc-0000-0000-0000-000000000002',
  accountant: 'cccccccc-0000-0000-0000-000000000003',
};
const BRANCH = sql(`select id from branches where deleted_at is null and is_active order by name limit 1`);
// סניף של מנהלת הסניף — כדי לבדוק גם את מסך הסניף שלה עצמה.
const MANAGER_BRANCH = sql(`select branch_id from branch_staff where user_id = '${'cccccccc-0000-0000-0000-000000000002'}' order by branch_id limit 1`);
const PRODUCTION = sql(`select id from productions order by created_at limit 1`);

// [נתיב, כותרת צפויה, אילו תפקידים, ציפייה שונה לפי תפקיד].
// כותרת null = מסך בלי h1 קבוע (נבדק שיש כותרת). ציפייה לפי תפקיד = טקסט שחייב
// להופיע — למשל "הסניף לא נמצא" למנהלת שאינה משויכת: זו ההרשאה, לא תקלה.
const ALL = ['owner', 'branch_manager', 'accountant'];
const SCREENS = [
  ['/', 'דשבורד', ALL],
  ['/branches', 'סניפים', ALL],
  [`/branches/${BRANCH}`, null, ALL, { branch_manager: 'הסניף לא נמצא' }],
  [`/branches/${MANAGER_BRANCH}`, null, ['branch_manager']],
  ['/students', 'תלמידות', ALL],
  ['/collection', 'גבייה', ALL],
  ['/expenses', 'הוצאות סניפים', ALL],
  ['/general', 'כספים כלליים', ALL],
  ['/reports', 'דוחות', ALL],
  ['/attendance', 'נוכחות', ALL],
  ['/productions', 'הפקות סרטים', ALL],
  ...(PRODUCTION ? [[`/productions/${PRODUCTION}`, null, ALL, { branch_manager: 'ההפקה לא נמצאה' }]] : []),
  ['/reminders', 'תזכורות', ALL],
  ['/standing-orders', 'הוראות קבע', ALL],
  ['/settings', 'הגדרות', ALL],
  ['/agent', 'סוכן הלקוחות', ['owner']],
  ['/users', 'משתמשים', ['owner']],
  ['/mailing', 'רשימת תפוצה', ['owner']],
];

const { check, failed } = reporter();
const ui = await startUi();
try {
  for (const role of ALL) {
    console.log(`\n  ── ${role} ──`);
    const { page, log } = await ui.newPage(USERS[role]);
    for (const [path, title, roles, expectText = {}] of SCREENS) {
      if (!roles.includes(role)) continue;
      log.pageErrors.length = 0; log.badResponses.length = 0;
      await page.goto(`${ui.app}${path}`, { waitUntil: 'domcontentloaded' });
      await page.locator('h1').first().waitFor({ timeout: 15000 }).catch(() => undefined);
      const s = await screenState(page);
      const want = expectText[role];
      const wantShown = want ? (await page.getByText(want).count()) > 0 : true;
      const problems = [
        want && !wantShown && `לא הוצג "${want}"`,
        s.crashed && `קריסה:\n${s.details}`,
        s.loadError && 'מוצג "לא הצלחנו לטעון"',
        ...log.pageErrors.map((e) => `JS: ${e}`),
        ...log.badResponses.map((r) => `שאילתה נדחתה: ${r}`),
        !want && title && s.h1 !== title && `כותרת: "${s.h1}" במקום "${title}"`,
        !want && !title && !s.h1 && 'אין כותרת — המסך לא נטען',
      ].filter(Boolean);
      check(`${path} — ${want ? `"${want}" (הרשאה)` : title ?? s.h1}`, problems.length === 0, problems.join('\n'));
    }

    // ★ כרטיס תלמידה: לחיצה על שם פותחת אותו (נפל ב-production: React #310).
    // רואת חשבון לא רואה תלמידות (RLS) — היא לא בודקת כרטיס.
    if (role === 'accountant') { await page.close(); continue; }
    log.pageErrors.length = 0; log.badResponses.length = 0;
    await page.goto(`${ui.app}/students`, { waitUntil: 'domcontentloaded' });
    const row = page.locator('tbody tr').first();
    await row.waitFor({ timeout: 15000 }).catch(() => undefined);
    const name = ((await row.locator('td').first().textContent().catch(() => '')) ?? '').trim();
    check(`כרטיס תלמידה: יש תלמידות ברשימה (${name || 'ריקה'})`, Boolean(name));
    if (name) {
      await row.locator('td').first().click();
      await page.getByRole('dialog').first().waitFor({ timeout: 10000 }).catch(() => undefined);
      const s = await screenState(page);
      const dialog = page.getByRole('dialog').first();
      const opened = (await page.getByRole('dialog').count()) > 0 && await dialog.getByText(name).first().isVisible().catch(() => false);
      check(`★ כרטיס תלמידה נפתח (${name})`, !s.crashed && opened && log.pageErrors.length === 0 && log.badResponses.length === 0,
        [s.crashed && `קריסה:\n${s.details}`, !opened && 'הכרטיס לא נפתח', ...log.pageErrors, ...log.badResponses].filter(Boolean).join('\n'));
    }
    await page.close();
  }
} finally {
  await ui.stop();
}

if (failed()) { console.log(`\n  ✗ ${failed()} בדיקות מסכים נכשלו`); process.exit(1); }
console.log('\n  כל המסכים נטענו, לכל התפקידים');
