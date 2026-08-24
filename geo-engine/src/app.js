'use strict';

/**
 * הממשק המקומי.
 *
 * למה זה קיים: המנוע עבד, אבל כל שימוש בו דרש פקודות, נתיבים, מזהי ריצה
 * ומחרוזות להדבקה. זה הפך כל בדיקה למשימה טכנית במקום ללחיצה.
 *
 * שרת קטן שרץ רק על 127.0.0.1, מגיש עמוד אחד, ומריץ מאחוריו בדיוק את אותן
 * פקודות של ה-CLI. שום דבר לא יוצא החוצה, ואין תלות חדשה.
 *
 * הממשק בדפדפן ולא בטרמינל מסיבה אחת: עברית בקונסולת Windows מוצגת הפוך.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DB = require('./db');
const R = require('./run');

const ROOT = path.join(__dirname, '..');
const PORT = 7317;

/* ---------- הרצת פקודות ---------- */

// כל ריצה פעילה, כדי שהעמוד יוכל למשוך את הפלט שלה
const jobs = {};
let jobSeq = 0;

/** מריץ את ה-CLI כתהליך נפרד ואוסף את הפלט. הארגומנטים כמערך — לא מחרוזת. */
function startJob(args, label) {
  const id = String(++jobSeq);
  const job = { id, label, args, lines: [], done: false, code: null, started: Date.now() };
  jobs[id] = job;

  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'cli.js')].concat(args), {
    cwd: ROOT,
    env: Object.assign({}, process.env, { FORCE_COLOR: '0' })
  });

  const take = (buf) => {
    for (const line of String(buf).split(/\r?\n/)) {
      if (line.trim()) job.lines.push(line.replace(/\[[0-9;]*m/g, ''));
    }
    if (job.lines.length > 500) job.lines.splice(0, job.lines.length - 500);
  };
  child.stdout.on('data', take);
  child.stderr.on('data', take);
  child.on('close', (code) => { job.done = true; job.code = code; });
  child.on('error', (e) => { job.lines.push('שגיאה: ' + e.message); job.done = true; job.code = 1; });

  job.child = child;
  return job;
}

/* ---------- קריאת מצב ---------- */

const ENGINE_LABEL = { chatgpt: 'ChatGPT', gemini: 'Gemini', google_aio: 'תשובות AI בגוגל' };

function readState() {
  const db = DB.open();
  const clients = db.prepare('SELECT slug, name, trade, city FROM clients ORDER BY name').all();
  const runs = db.prepare(`
    SELECT runs.id, runs.started_at, runs.status, clients.slug, clients.name,
           (SELECT COUNT(*) FROM results WHERE results.run_id = runs.id) AS cells,
           (SELECT COUNT(DISTINCT engine) FROM results WHERE results.run_id = runs.id) AS engines,
           (SELECT GROUP_CONCAT(DISTINCT engine) FROM results WHERE results.run_id = runs.id) AS engine_list,
           (SELECT COUNT(*) FROM results WHERE results.run_id = runs.id AND verified_by_human = 1) AS verified
    FROM runs JOIN clients ON clients.id = runs.client_id
    ORDER BY runs.id DESC LIMIT 40
  `).all();
  db.close();

  for (const r of runs) {
    r.engineNames = String(r.engine_list || '').split(',').filter(Boolean)
      .map(e => ENGINE_LABEL[e] || e).join(' · ');
    r.date = String(r.started_at || '').slice(0, 16).replace('T', ' ');
  }

  const reportsDir = path.join(ROOT, 'reports');
  let reports = [];
  if (fs.existsSync(reportsDir)) {
    reports = fs.readdirSync(reportsDir)
      .filter(f => /\.(pdf|html)$/i.test(f) && !/-review\.html$/i.test(f))
      .map(f => ({ file: f, mtime: fs.statSync(path.join(reportsDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime).slice(0, 20).map(x => x.file);
  }

  const clientFiles = fs.existsSync(path.join(ROOT, 'clients'))
    ? fs.readdirSync(path.join(ROOT, 'clients')).filter(f => f.endsWith('.json')) : [];

  return {
    clients, runs, reports, clientFiles,
    branded: fs.existsSync(path.join(ROOT, 'config', 'brand.json')),
    engines: Object.keys(ENGINE_LABEL).map(k => ({ key: k, label: ENGINE_LABEL[k] }))
  };
}

/** פותח קובץ בתוכנה שמוגדרת אצלו במערכת */
function openLocal(file) {
  const full = path.join(ROOT, 'reports', path.basename(file));
  if (!fs.existsSync(full)) throw new Error('הקובץ לא נמצא: ' + path.basename(file));
  const cmd = process.platform === 'win32' ? 'explorer'
            : process.platform === 'darwin' ? 'open' : 'xdg-open';
  try { spawn(cmd, [full], { detached: true, stdio: 'ignore' }).unref(); } catch (e) { /* לא קריטי */ }
  return full;
}

/* ---------- ולידציה ---------- */

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/i;
const ENGINES = ['chatgpt', 'gemini', 'google_aio'];

function ids(v) {
  return String(v || '').split(',').map(x => parseInt(x, 10))
    .filter(n => Number.isInteger(n) && n > 0 && n < 1e7);
}

/* ---------- ניתוב ---------- */

function json(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(s);
}

function handle(req, res, body) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;

  if (p === '/' || p === '/index.html') {
    const html = fs.readFileSync(path.join(__dirname, 'app.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(html);
  }

  if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }

  // דף האימות מוגש מכאן ולא כקובץ, כדי שהשמירה תהיה באותו מקור —
  // בלי CORS, בלי טוקן, ובלי להעתיק שורה בין שני חלונות.
  if (p === '/review') {
    const id = parseInt(url.searchParams.get('run'), 10);
    if (!Number.isInteger(id) || id < 1) return json(res, 400, { error: 'ריצה לא תקינה' });
    try {
      const html = require('./review').buildFor(id, DB);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html);
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  if (p === '/api/state') return json(res, 200, readState());

  if (p === '/api/job' && req.method === 'GET') {
    const j = jobs[url.searchParams.get('id')];
    if (!j) return json(res, 404, { error: 'ריצה לא נמצאה' });
    return json(res, 200, { id: j.id, label: j.label, lines: j.lines, done: j.done, code: j.code });
  }

  if (req.method !== 'POST') return json(res, 404, { error: 'לא נמצא' });
  const b = body || {};

  try {
    if (p === '/api/client-add') {
      const f = path.basename(String(b.file || ''));
      if (!/^[\w.\- ]+\.json$/.test(f)) throw new Error('שם קובץ לא תקין');
      // basename כבר חוסם יציאה מהתיקייה; הבדיקה כאן היא כדי שהתשובה תהיה
      // כנה — קובץ שאינו קיים ייפול בהמשך, ואז השגיאה כבר לא נראית בממשק
      if (!fs.existsSync(path.join(ROOT, 'clients', f))) throw new Error('הקובץ לא נמצא: clients/' + f);
      return json(res, 200, { job: startJob(['client:add', 'clients/' + f], 'טעינת לקוח').id });
    }

    if (p === '/api/run') {
      const slug = String(b.slug || '');
      if (!SLUG_RE.test(slug)) throw new Error('לקוח לא תקין');
      const args = ['run', slug];
      if (b.engine) {
        if (ENGINES.indexOf(String(b.engine)) === -1) throw new Error('מנוע לא מוכר');
        args.push('--engine=' + b.engine);
      }
      if (b.cdp) args.push('--cdp');
      return json(res, 200, { job: startJob(args, 'בדיקה').id });
    }

    if (p === '/api/browser') {
      return json(res, 200, { job: startJob(['browser'], 'פתיחת הדפדפן').id });
    }

    if (p === '/api/verify' && b.run && b.set) {
      const id = ids(b.run)[0];
      if (!id) throw new Error('לא נבחרה ריצה');
      const spec = String(b.set || '').trim();
      if (!/^\d+:(n|[0-3])(,\d+:(n|[0-3]))*$/i.test(spec)) throw new Error('שורת הסימון לא תקינה');
      const r = require('./cli').applySet(id, spec);
      return json(res, 200, Object.assign({ saved: true }, r));
    }



    if (p === '/api/report') {
      const list = ids(b.runs);
      if (!list.length) throw new Error('לא נבחרו ריצות');
      const args = ['report', list.join(',')];
      const vs = ids(b.vs);
      if (vs.length) args.push('--vs=' + vs.join(','));
      return json(res, 200, { job: startJob(args, 'הפקת דוח').id });
    }

    if (p === '/api/open') return json(res, 200, { opened: path.basename(openLocal(String(b.file || ''))) });

    if (p === '/api/stop') {
      const j = jobs[String(b.job || '')];
      if (j && j.child && !j.done) { try { j.child.kill(); } catch (e) {} }
      return json(res, 200, { stopped: true });
    }
  } catch (e) {
    return json(res, 400, { error: e.message });
  }

  return json(res, 404, { error: 'לא נמצא' });
}

/** פותח כתובת בדפדפן ברירת המחדל של המשתמש */
function openUrl(url) {
  const cmd = process.platform === 'win32' ? 'explorer'
            : process.platform === 'darwin' ? 'open' : 'xdg-open';
  try { spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref(); } catch (e) { /* לא קריטי */ }
}

/**
 * בודק אם מה שתפוס בפורט הוא הממשק שלנו.
 * לחיצה שנייה על הקיצור לא אמורה להיות שגיאה — היא אמורה להחזיר את החלון.
 */
function alreadyMine(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/state', timeout: 1500 }, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; if (raw.length > 1e6) req.destroy(); });
      res.on('end', () => {
        try { resolve(Array.isArray(JSON.parse(raw).runs)); } catch (e) { resolve(false); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

function start(opts) {
  opts = opts || {};
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => {
      let body = null;
      if (raw) { try { body = JSON.parse(raw); } catch (e) { body = null; } }
      try { handle(req, res, body); }
      catch (e) {
        try { json(res, 500, { error: e.message }); } catch (e2) { /* התשובה כבר נשלחה */ }
      }
    });
  });

  return new Promise((resolve, reject) => {
    // רק מקומי. השרת הזה לא אמור להיות נגיש מהרשת בשום מצב.
    server.listen(opts.port || PORT, '127.0.0.1', () => {
      const port = server.address().port;
      const url = 'http://127.0.0.1:' + port + '/';
      if (opts.open !== false) openUrl(url);
      resolve({ server, port, url });
    });
    server.on('error', reject);
  });
}

module.exports = { start, readState, handle, openUrl, alreadyMine, PORT };

if (require.main === module) {
  start({}).then(({ url }) => {
    console.log('');
    console.log('  מנוע בדיקת נראות — הממשק פתוח בכתובת:');
    console.log('  ' + url);
    console.log('');
    console.log('  אם הדפדפן לא נפתח לבד, העתק את הכתובת לשם.');
    console.log('  לסגירה: סגור את החלון הזה.');
    console.log('');
  }).catch(async (e) => {
    if (e.code === 'EADDRINUSE' && await alreadyMine(PORT)) {
      const url = 'http://127.0.0.1:' + PORT + '/';
      openUrl(url);
      console.log('\n  הממשק כבר פתוח. מחזיר אותך אליו:');
      console.log('  ' + url + '\n');
      return;
    }
    console.error('\nלא הצלחתי לפתוח את הממשק: ' + e.message);
    if (e.code === 'EADDRINUSE') {
      console.error('הפורט ' + PORT + ' תפוס על ידי תוכנה אחרת.');
    }
    process.exit(1);
  });
}
