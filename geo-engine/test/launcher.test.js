'use strict';

/**
 * בדיקות למשגר — החוזה בין GEO.vbs לתוכנה.
 *
 * למה זה קיים: המשגר מריץ את התוכנה בלי חלון בכלל. אם היא נופלת, אין
 * מסך שמראה את זה. הקשר היחיד ביניהם הוא שני קבצי סימן, ולכן שבירה
 * שקטה שלהם פירושה תוכנה שלא נפתחת ולא מסבירה למה.
 *
 * הרצה: npm run test:launcher
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 7317;
const URL_FILE = path.join(ROOT, 'data', 'app-url.txt');
const ERR_FILE = path.join(ROOT, 'data', 'app-error.txt');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  ' + extra : '')); }
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));

function ping(method, p) {
  return new Promise((resolve) => {
    const body = method === 'POST' ? '{}' : null;
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: p, method, timeout: 2000,
      headers: body ? { 'Content-Type': 'application/json', 'Content-Length': 2 } : {}
    }, (res) => {
      let b = '';
      res.on('data', c => { b += c; });
      res.on('end', () => resolve({ code: res.statusCode, body: b }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.on('error', e => resolve({ error: e.code }));
    if (body) req.write(body);
    req.end();
  });
}

(async () => {
  console.log('\n— המשגר —');

  const busy = await ping('GET', '/api/state');
  if (!busy.error) {
    console.log('  ⚠ הפורט ' + PORT + ' כבר תפוס — מדלג. סגור את התוכנה והרץ שוב.\n');
    process.exit(0);
  }

  for (const f of [URL_FILE, ERR_FILE]) { try { fs.unlinkSync(f); } catch (e) {} }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-launch-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'app.js')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, {
      GEO_DB: path.join(tmp, 'l.db'), GEO_CONFIG: path.join(tmp, 'config')
    })
  });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });

  let signalled = false;
  for (let i = 0; i < 80; i++) {
    if (fs.existsSync(URL_FILE)) { signalled = true; break; }
    if (fs.existsSync(ERR_FILE)) break;
    await wait(250);
  }

  ok('התוכנה מסמנת שהיא עלתה', signalled, out.slice(-400));
  if (signalled) {
    ok('הסימן מכיל את הכתובת המקומית',
       fs.readFileSync(URL_FILE, 'utf8').trim() === 'http://127.0.0.1:' + PORT + '/',
       fs.readFileSync(URL_FILE, 'utf8'));
  }
  ok('אין קובץ שגיאה כשהכל תקין', !fs.existsSync(ERR_FILE));

  const alive = await ping('GET', '/api/state');
  ok('הממשק עונה', alive.code === 200, JSON.stringify(alive));

  const quit = await ping('POST', '/api/quit');
  ok('בקשת הסגירה מאושרת', quit.code === 200 && /closing/.test(quit.body || ''), JSON.stringify(quit));

  for (let i = 0; i < 40 && child.exitCode === null; i++) await wait(100);
  ok('התהליך נסגר מעצמו', child.exitCode === 0, 'קוד ' + child.exitCode);
  ok('קובץ הסימן נמחק בסגירה', !fs.existsSync(URL_FILE));

  const dead = await ping('GET', '/api/state');
  ok('הפורט השתחרר', dead.error === 'ECONNREFUSED', JSON.stringify(dead));

  try { child.kill(); } catch (e) {}
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const f of [URL_FILE, ERR_FILE]) { try { fs.unlinkSync(f); } catch (e) {} }

  console.log(`\n${pass} עברו, ${fail} נכשלו\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('\nהבדיקות נפלו: ' + e.stack);
  process.exit(1);
});
