// ui-student-card.test.mjs — פותח כרטיס תלמידה בדפדפן אמיתי ומוודא שהוא נטען.
//
// הלקח: כרטיס התלמידה קרס (hook אחרי return מוקדם → React #310) ושום בדיקה לא
// תפסה, כי אף בדיקה לא רינדרה מסך. כאן: בונים את האפליקציה, מגישים אותה מקומית,
// Supabase מדומה ברמת הרשת (page.route), ולוחצים על שם תלמידה כמו משתמשת.
// אין כאן רשת חיצונית ואין מסד — רק הקוד של המסך.
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SB = 'http://crmtest.supabase.test';
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${name}${ok || !extra ? '' : `\n${extra}`}`); if (!ok) failed++; };

// ── דפדפן: מקומי (/opt/pw-browsers), CI (google-chrome של ה-runner), או CHROME_PATH ──
const CHROME = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  .find((p) => p && existsSync(p) && statSync(p).isFile());
if (!CHROME) { console.log('  ✗ לא נמצא דפדפן (CHROME_PATH)'); process.exit(1); }

// ── בילד עם Supabase מדומה ──
const out = mkdtempSync(join(tmpdir(), 'crm-ui-'));
execFileSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], {
  cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'],
  env: { ...process.env, VITE_SUPABASE_URL: SB, VITE_SUPABASE_ANON_KEY: 'test-anon-key' },
});

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
// מגיש את קבצי הבילד (לא קורא קוד מקור — את זה בודקים דרך הדפדפן).
const server = createServer(async (req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = join(out, path);
  if (!file.startsWith(out) || !existsSync(file) || statSync(file).isDirectory()) file = join(out, 'index.html'); // SPA
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(await readFile(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const APP = `http://127.0.0.1:${server.address().port}`;

// ── נתונים מדומים ──
const USER = '11111111-1111-1111-1111-111111111111';
const BRANCH = { id: 'bbbbbbbb-0000-0000-0000-000000000001', name: 'סניף בדיקה', is_active: true, deleted_at: null, city: 'ירושלים', default_tuition: 2000, plan: null, program_name: null, collect_payments: true };
const STUDENT = {
  id: 'dddddddd-0000-0000-0000-000000000001', full_name: 'שירה כהן', first_name: 'שירה', last_name: 'כהן', branch_id: BRANCH.id, branch_name: BRANCH.name,
  season_id: 'aaaaaaaa-0000-0000-0000-000000000001', grade: 'ד', parent_name: 'רחלי כהן', parent_phone: '972501234567', status: 'active',
  due: 2500, paid: 1000, balance: 1500, attendance_pct: 90, discount: 0, discount_reason: null, registration_fee: 100,
  trial_started_on: null, cancelled_at: null, terms_accepted_at: null, refund_amount: null, notes: null, email: null, school: null,
};
const PROFILE = { id: USER, role: 'owner', is_active: true, full_name: 'בעלים בדיקה', email: 'owner@test.local', branch_ids: [] };
const TABLES = {
  profiles: [PROFILE], v_student_overview: [STUDENT], branches: [BRANCH], v_branch_pnl: [], payments: [],
  students: [{ id: STUDENT.id, payment_track: null, whatsapp_opt_in: true, photo_consent_text: null, terms_text: null, external_payment: false }],
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = Math.floor(Date.now() / 1000) + 3600;
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER, role: 'authenticated', exp, email: PROFILE.email })}.sig`;
const SESSION = { access_token: JWT, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp,
  user: { id: USER, aud: 'authenticated', role: 'authenticated', email: PROFILE.email, app_metadata: { provider: 'google' }, user_metadata: {}, created_at: new Date().toISOString() } };

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
try {
  // מסך טלפון — שם המשתמש דיווח על התקלה.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), ['sb-crmtest-auth-token', JSON.stringify(SESSION)]);
  await page.route(`${SB}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const single = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
    let body = [];
    if (url.pathname.startsWith('/auth/v1/user')) body = SESSION.user;
    else if (url.pathname.startsWith('/auth/v1/')) body = SESSION;
    else if (url.pathname.startsWith('/rest/v1/rpc/')) body = null;
    else if (url.pathname.startsWith('/rest/v1/')) {
      const rows = TABLES[url.pathname.slice('/rest/v1/'.length)] ?? [];
      body = single ? (rows[0] ?? null) : rows;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  });

  await page.goto(`${APP}/students`, { waitUntil: 'networkidle' });
  const nameCell = page.getByText(STUDENT.full_name, { exact: true }).first();
  await nameCell.waitFor({ timeout: 15000 });
  check('רשימת התלמידות נטענה, עם התלמידה', await nameCell.isVisible());

  await nameCell.click();
  await page.waitForTimeout(1500);
  const crashed = await page.getByText('משהו השתבש').count() > 0;
  const details = crashed ? await page.locator('[data-testid="error-details"]').textContent().catch(() => '') : '';
  check('★ לחיצה על שם — אין מסך קריסה', !crashed, details ? `    ${details.split('\n').join('\n    ')}` : '');
  const dialog = page.getByRole('dialog');
  const opened = (await dialog.count()) > 0 && await dialog.first().getByText(STUDENT.full_name).first().isVisible().catch(() => false);
  check('★ כרטיס התלמידה נפתח ומציג את שמה', opened);
  check('★ כרטיס התלמידה מציג את היתרה', opened && await dialog.first().getByText('1,500', { exact: false }).first().isVisible().catch(() => false));
  check('אין שגיאות JavaScript בדף', pageErrors.length === 0, pageErrors.map((e) => `    ${e}`).join('\n'));
} finally {
  await browser.close();
  server.close();
  rmSync(out, { recursive: true, force: true });
}

if (failed) { console.log(`  ✗ ${failed} בדיקות כרטיס התלמידה נכשלו`); process.exit(1); }
console.log('  כל בדיקות כרטיס התלמידה (דפדפן) עברו');
