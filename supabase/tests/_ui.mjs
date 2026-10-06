// _ui.mjs — תשתית לבדיקות מסך בדפדפן אמיתי.
//
// הלקח: שלוש פעמים מסך נשבר ב-production ושום בדיקה לא תפסה, כי אף בדיקה לא
// רינדרה מסך. כאן כל השרשרת אמיתית חוץ מהענן:
//   · בילד production של האפליקציה (vite build), מוגש מקומית.
//   · PostgREST אמיתי (אותו שרת ש-Supabase מריץ) מול המסד המקומי של הבדיקות —
//     עם RLS, views ו-RPC אמיתיים. שאילתה שבורה מחזירה 4xx בדיוק כמו בענן.
//   · Chromium במסך טלפון. ההתחברות: JWT חתום, כמו ש-GoTrue מנפיק.
// רק auth ו-Edge Functions מדומים (אין GoTrue/Deno מקומי).
import { execFileSync, spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer as netServer } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SB = 'http://crmtest.supabase.test';
const JWT_SECRET = 'ui-test-secret-ui-test-secret-0123456789';
const PG = { host: process.env.PGHOST ?? '/tmp', port: process.env.PGPORT ?? '5433', user: process.env.PGUSER ?? 'postgres', db: 'teichtal' };
const PGRST_VERSION = 'v12.2.3';

export function sql(query) {
  return execFileSync('psql', ['-h', PG.host, '-p', PG.port, '-U', PG.user, '-d', PG.db, '-At', '-v', 'ON_ERROR_STOP=1', '-c', query],
    { encoding: 'utf8', env: { ...process.env } }).trim();
}

const freePort = () => new Promise((r) => { const s = netServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
export function signJwt(payload) {
  const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}`;
  return `${head}.${createHmac('sha256', JWT_SECRET).update(head).digest('base64url')}`;
}

function findChrome() {
  return [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
    .find((p) => p && existsSync(p) && statSync(p).isFile());
}

function postgrestBin() {
  if (process.env.POSTGREST_BIN && existsSync(process.env.POSTGREST_BIN)) return process.env.POSTGREST_BIN;
  const dir = join(tmpdir(), `postgrest-${PGRST_VERSION}`);
  const bin = join(dir, 'postgrest');
  if (!existsSync(bin)) {
    mkdirSync(dir, { recursive: true });
    const tar = join(dir, 'p.tar.xz');
    execFileSync('curl', ['-fsSL', '-o', tar, `https://github.com/PostgREST/postgrest/releases/download/${PGRST_VERSION}/postgrest-${PGRST_VERSION}-linux-static-x64.tar.xz`]);
    execFileSync('tar', ['-xJf', tar, '-C', dir]);
  }
  return bin;
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };

/** מעלה הכול: בילד, אתר סטטי, PostgREST ודפדפן. מחזיר כלים לבדיקה. */
export async function startUi() {
  const chrome = findChrome();
  if (!chrome) throw new Error('לא נמצא דפדפן (CHROME_PATH)');

  // ── בילד ──
  const out = mkdtempSync(join(tmpdir(), 'crm-ui-'));
  execFileSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], {
    cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, VITE_SUPABASE_URL: SB, VITE_SUPABASE_ANON_KEY: signJwt({ role: 'anon' }) },
  });
  const site = createServer(async (req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let file = join(out, path);
    if (!file.startsWith(out) || !existsSync(file) || statSync(file).isDirectory()) file = join(out, 'index.html'); // SPA
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  const app = `http://127.0.0.1:${site.address().port}`;

  // ── PostgREST ──
  const pgPort = await freePort();
  const host = PG.host.startsWith('/') ? `host=${encodeURIComponent(PG.host)}&` : '';
  const dbUri = PG.host.startsWith('/')
    ? `postgres://${PG.user}@/${PG.db}?${host}port=${PG.port}`
    : `postgres://${PG.user}:${encodeURIComponent(process.env.PGPASSWORD ?? '')}@${PG.host}:${PG.port}/${PG.db}`;
  const pgrst = spawn(postgrestBin(), [], {
    env: { ...process.env, PGRST_DB_URI: dbUri, PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: JWT_SECRET,
      PGRST_SERVER_PORT: String(pgPort), PGRST_SERVER_HOST: '127.0.0.1', PGRST_DB_POOL: '4', PGRST_LOG_LEVEL: 'crit' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let pgrstErr = '';
  pgrst.stderr.on('data', (d) => { pgrstErr += d; });
  const rest = `http://127.0.0.1:${pgPort}`;
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${rest}/`)).ok) break; } catch { /* עוד לא עלה */ }
    if (i > 60) throw new Error(`PostgREST לא עלה: ${pgrstErr}`);
    await new Promise((r) => setTimeout(r, 250));
  }

  const browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] });

  /**
   * דף חדש כמשתמשת מחוברת (userId) או כאורחת (null). כל בקשה ל-Supabase עוברת
   * ל-PostgREST המקומי; כל תשובת 4xx/5xx נרשמת — שאילתה שבורה היא כשל.
   */
  async function newPage(userId) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const log = { pageErrors: [], badResponses: [] };
    page.on('pageerror', (e) => log.pageErrors.push(e.message));
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const user = userId && { id: userId, aud: 'authenticated', role: 'authenticated', email: 'ui@test.local', app_metadata: { provider: 'google' }, user_metadata: {}, created_at: new Date().toISOString() };
    const token = userId && signJwt({ sub: userId, role: 'authenticated', aud: 'authenticated', exp, email: user.email });
    if (userId) {
      const session = { access_token: token, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp, user };
      await page.addInitScript(([k, v]) => localStorage.setItem(k, v), ['sb-crmtest-auth-token', JSON.stringify(session)]);
    }
    await page.route(`${SB}/**`, async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (url.pathname.startsWith('/auth/v1/')) {
        return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(url.pathname.startsWith('/auth/v1/user') ? user : {}) });
      }
      if (url.pathname.startsWith('/functions/v1/')) {
        return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '{}' });
      }
      if (url.pathname.startsWith('/rest/v1/')) {
        const headers = { ...req.headers() };
        delete headers.host; delete headers.origin; delete headers.referer;
        headers.authorization = `Bearer ${token ?? signJwt({ role: 'anon' })}`;
        const res = await fetch(`${rest}${url.pathname.slice('/rest/v1'.length)}${url.search}`, { method: req.method(), headers, body: req.postDataBuffer() ?? undefined });
        const body = Buffer.from(await res.arrayBuffer());
        if (res.status >= 400) log.badResponses.push(`${req.method()} ${url.pathname}${url.search ? decodeURIComponent(url.search).slice(0, 160) : ''} → ${res.status} ${body.toString().slice(0, 300)}`);
        const out = { ...cors };
        res.headers.forEach((v, k) => { if (!['content-encoding', 'transfer-encoding', 'connection'].includes(k)) out[k] = v; });
        return route.fulfill({ status: res.status, headers: out, body });
      }
      return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    return { page, log };
  }

  async function stop() {
    await browser.close().catch(() => undefined);
    pgrst.kill();
    site.close();
    rmSync(out, { recursive: true, force: true });
  }

  return { app, newPage, stop };
}

/** מצב המסך אחרי טעינה: קריסה (עם הפרטים הטכניים), שגיאת טעינה, וכותרת. */
export async function screenState(page) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(400);
  const crashed = (await page.getByText('משהו השתבש').count()) > 0;
  const details = crashed ? (await page.locator('[data-testid="error-details"]').textContent().catch(() => '')) ?? '' : '';
  const loadError = (await page.getByText('לא הצלחנו לטעון').count()) > 0;
  const h1 = ((await page.locator('h1').first().textContent({ timeout: 2000 }).catch(() => '')) ?? '').trim();
  return { crashed, details, loadError, h1 };
}

export function reporter() {
  let failed = 0;
  const check = (name, ok, extra = '') => {
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
    if (!ok) { failed++; if (extra) console.log(String(extra).split('\n').map((l) => `      ${l}`).join('\n')); }
  };
  return { check, failed: () => failed };
}
