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
// GEO_CONFIG קיים כדי שבדיקות יכתבו מיתוג לתיקייה זמנית ולא ידרסו את שלך
const CONFIG = process.env.GEO_CONFIG ? path.resolve(process.env.GEO_CONFIG) : path.join(ROOT, 'config');
const PORT = 7317;

/* ---------- סימני חיים ---------- */

/**
 * המשגר ב-Windows מריץ את התוכנה בלי חלון, ולכן אין לו דרך לראות אם היא עלתה.
 * שני הקבצים האלה הם התשובה: כתובת = הצליח, שגיאה = נפל ויש מה להראות.
 */
const SIGNAL_DIR = path.join(ROOT, 'data');
const URL_FILE = path.join(SIGNAL_DIR, 'app-url.txt');
const ERR_FILE = path.join(SIGNAL_DIR, 'app-error.txt');

function signal(file, text) {
  try {
    fs.mkdirSync(SIGNAL_DIR, { recursive: true });
    fs.writeFileSync(file, String(text), 'utf8');
  } catch (e) { /* חוסר הרשאה לא אמור להפיל את התוכנה */ }
}
function clearSignals() {
  for (const f of [URL_FILE, ERR_FILE]) { try { fs.unlinkSync(f); } catch (e) {} }
}

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
    branded: fs.existsSync(path.join(CONFIG, 'brand.json')),
    engines: Object.keys(ENGINE_LABEL).map(k => ({ key: k, label: ENGINE_LABEL[k] }))
  };
}

/* ---------- לקוחות ---------- */

/**
 * הלקוח כפי שהטופס צריך אותו.
 * השאלות מוחזרות רק כטקסט — המזהים שלהן פנימיים, והממשק לא אמור לגעת בהם.
 */
function readClient(slug) {
  const db = DB.open();
  const c = DB.getClient(db, slug);
  db.close();
  if (!c) throw new Error('לקוח לא נמצא: ' + slug);
  return {
    slug: c.slug, name: c.name, nameVariants: c.nameVariants || [],
    trade: c.trade || '', city: c.city || '', city2: c.city2 || '',
    extra: c.extra || '', domain: c.domain || '',
    competitors: c.competitors || [],
    questions: (c.questions || []).map(q => q.text)
  };
}

/** מזהה פנוי ללקוח חדש. הוא מופיע בשם קובץ הדוח, ולכן הוא באנגלית */
function nextSlug() {
  const db = DB.open();
  const taken = {};
  for (const r of db.prepare('SELECT slug FROM clients').all()) taken[r.slug] = true;
  db.close();
  let n = 2;
  while (taken['client' + n]) n++;
  return 'client' + n;
}

function saveClient(b) {
  const slug = String((b && b.slug) || '').trim().toLowerCase();
  if (!SLUG_RE.test(slug)) throw new Error('המזהה חייב להיות באותיות אנגליות או ספרות, בלי רווחים');

  const name = String((b && b.name) || '').trim();
  if (!name) throw new Error('חסר שם העסק');
  if (name.length > 120) throw new Error('שם העסק ארוך מדי');

  const questions = (Array.isArray(b.questions) ? b.questions : [])
    .map(q => String(q).trim()).filter(Boolean);
  if (!questions.length) throw new Error('צריך לפחות שאלה אחת');
  if (questions.length > 60) throw new Error('יותר מ-60 שאלות — זו ריצה של שעות. צמצם.');
  if (questions.some(q => q.length > 400)) throw new Error('אחת השאלות ארוכה מדי');

  const competitors = (Array.isArray(b.competitors) ? b.competitors : [])
    .map(r => ({ name: String((r && r.name) || '').trim(),
                 variants: (Array.isArray(r && r.variants) ? r.variants : [])
                   .map(v => String(v).trim()).filter(Boolean) }))
    .filter(r => r.name);
  if (competitors.length > 100) throw new Error('יותר מ-100 מתחרים');

  const db = DB.open();
  const exists = !!db.prepare('SELECT id FROM clients WHERE slug = ?').get(slug);
  if (b.isNew && exists) { db.close(); throw new Error('כבר קיים לקוח עם המזהה "' + slug + '"'); }

  const txt = v => { const t = String(v || '').trim(); return t.length > 200 ? t.slice(0, 200) : t; };
  DB.upsertClient(db, {
    slug, name, questions, competitors,
    nameVariants: (Array.isArray(b.nameVariants) ? b.nameVariants : [])
      .map(v => String(v).trim()).filter(Boolean),
    trade: txt(b.trade), city: txt(b.city), city2: txt(b.city2),
    extra: txt(b.extra), domain: txt(b.domain)
  });
  db.close();
  return readClient(slug);
}

/* ---------- מיתוג ---------- */

const BRAND_FIELDS = ['name', 'tagline', 'phone', 'email', 'site'];
const LOGO_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/svg+xml': '.svg' };
const MAX_LOGO = 2 * 1024 * 1024;

function brandFile() { return path.join(CONFIG, 'brand.json'); }

function readBrand() {
  const out = { name: '', tagline: '', phone: '', email: '', site: '', logo: '', logoData: '' };
  if (!fs.existsSync(brandFile())) return out;
  let b;
  try { b = JSON.parse(fs.readFileSync(brandFile(), 'utf8')); }
  catch (e) { throw new Error('config/brand.json אינו JSON תקין. תקן אותו או מחק אותו והזן מחדש.'); }
  for (const f of BRAND_FIELDS) if (typeof b[f] === 'string') out[f] = b[f];
  if (b.logo) {
    const lp = path.isAbsolute(b.logo) ? b.logo : path.join(ROOT, b.logo);
    out.logo = b.logo;
    // התצוגה המקדימה נשלחת מוטמעת, כי הדפדפן לא יכול לקרוא קובץ מהדיסק
    if (fs.existsSync(lp)) {
      const ext = path.extname(lp).toLowerCase();
      const mime = Object.keys(LOGO_EXT).find(m => LOGO_EXT[m] === ext) || 'image/png';
      out.logoData = 'data:' + mime + ';base64,' + fs.readFileSync(lp).toString('base64');
    } else {
      out.logoMissing = true;
    }
  }
  return out;
}

/**
 * שומר את המיתוג. הלוגו מגיע כ-data URI מהדפדפן ונשמר כקובץ,
 * כי report.js מטמיע אותו מהדיסק בזמן הפקת הדוח.
 */
function writeBrand(b) {
  const out = {};
  for (const f of BRAND_FIELDS) {
    const v = String((b && b[f]) || '').trim();
    if (v.length > 200) throw new Error('השדה "' + f + '" ארוך מדי');
    if (v) out[f] = v;
  }
  if (out.email && out.email.indexOf('@') === -1) throw new Error('כתובת המייל אינה נראית תקינה');

  const dir = CONFIG;
  fs.mkdirSync(dir, { recursive: true });

  if (b && b.logoData) {
    const m = String(b.logoData).match(/^data:([\w.+/-]+);base64,([A-Za-z0-9+/=\s]+)$/);
    if (!m) throw new Error('קובץ הלוגו לא נקרא כראוי. נסה קובץ אחר.');
    const ext = LOGO_EXT[m[1]];
    if (!ext) throw new Error('סוג הקובץ אינו נתמך. השתמש ב-PNG, JPG, WEBP או SVG.');
    const bytes = Buffer.from(m[2], 'base64');
    if (!bytes.length) throw new Error('קובץ הלוגו ריק');
    if (bytes.length > MAX_LOGO) throw new Error('הלוגו גדול מ-2 מגה. כווץ אותו ונסה שוב.');
    // מוחק לוגו קודם בפורמט אחר, אחרת יישארו שניים והדוח ייקח את הישן
    for (const e of Object.keys(LOGO_EXT).map(k => LOGO_EXT[k])) {
      const old = path.join(dir, 'logo' + e);
      if (e !== ext && fs.existsSync(old)) { try { fs.unlinkSync(old); } catch (err) {} }
    }
    fs.writeFileSync(path.join(dir, 'logo' + ext), bytes);
    // נשמר יחסית לשורש הפרויקט, כך שהוא נשאר תקף גם אם התיקייה תועתק
    out.logo = path.relative(ROOT, path.join(dir, 'logo' + ext)).split(path.sep).join('/');
  } else if (b && b.keepLogo) {
    const cur = readBrand();
    if (cur.logo) out.logo = cur.logo;
  }

  fs.writeFileSync(brandFile(), JSON.stringify(out, null, 2) + '\n', 'utf8');
  return readBrand();
}

/** פותח קובץ בתוכנה שמוגדרת אצלו במערכת */
function openLocal(file) {
  const full = path.join(ROOT, 'reports', path.basename(file));
  if (!fs.existsSync(full)) throw new Error('הקובץ לא נמצא: ' + path.basename(file));
  openDefault(full);
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

  if (p === '/api/client' && req.method === 'GET') {
    try { return json(res, 200, readClient(String(url.searchParams.get('slug') || ''))); }
    catch (e) { return json(res, 400, { error: e.message }); }
  }

  if (p === '/api/client-new' && req.method === 'GET') {
    return json(res, 200, { slug: nextSlug() });
  }

  if (p === '/api/brand' && req.method === 'GET') {
    try { return json(res, 200, readBrand()); }
    catch (e) { return json(res, 400, { error: e.message }); }
  }

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



    if (p === '/api/suggest-questions') {
      return json(res, 200, { questions: require('./questions').suggest(b) });
    }

    if (p === '/api/client-save') return json(res, 200, saveClient(b));

    if (p === '/api/brand') return json(res, 200, writeBrand(b));

    if (p === '/api/report') {
      const list = ids(b.runs);
      if (!list.length) throw new Error('לא נבחרו ריצות');
      const args = ['report', list.join(',')];
      const vs = ids(b.vs);
      if (vs.length) args.push('--vs=' + vs.join(','));
      return json(res, 200, { job: startJob(args, 'הפקת דוח').id });
    }

    if (p === '/api/open') return json(res, 200, { opened: path.basename(openLocal(String(b.file || ''))) });

    if (p === '/api/quit') {
      json(res, 200, { closing: true });
      // מרווח קצר כדי שהתשובה תספיק לצאת לפני שהתהליך נסגר
      setTimeout(() => { clearSignals(); process.exit(0); }, 200);
      return;
    }

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

// דפדפנים שיודעים לפתוח חלון בלי סרגל כתובות, לפי סדר עדיפות.
// Edge קודם: הוא תמיד קיים ב-Windows 11, וכרום שמור לריצות דרך הדפדפן שלך.
function appBrowsers() {
  const env = process.env;
  const dirs = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean);
  const rel = [
    ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
    ['Google', 'Chrome', 'Application', 'chrome.exe']
  ];
  const out = [];
  for (const r of rel) for (const d of dirs) out.push(path.join(d, ...r));
  return out;
}

/**
 * מפעיל תוכנה חיצונית בלי להסתכן בהפלת התוכנה.
 *
 * spawn לא זורק כשהקובץ לא קיים — הוא פולט אירוע error מאוחר יותר,
 * ואירוע error בלי מאזין מפיל את התהליך כולו. לכן המאזין כאן חובה,
 * והוא גם מה שמאפשר לנסות את המועמד הבא.
 */
function launch(cmd, args, onFail) {
  let failed = false;
  const fail = () => { if (!failed) { failed = true; if (onFail) onFail(); } };
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', fail);
    child.unref();
  } catch (e) { fail(); }
}

/** פותח בכלי ברירת המחדל של מערכת ההפעלה */
function openDefault(target) {
  const cmd = process.platform === 'win32' ? 'explorer'
            : process.platform === 'darwin' ? 'open' : 'xdg-open';
  launch(cmd, [target], () => { /* אין דרך נוספת; המשתמש יקבל את הכתובת בטקסט */ });
}

/**
 * פותח את הממשק. ב-Windows מנסה קודם חלון תוכנה — בלי סרגל כתובות
 * ובלי לשוניות — כדי שזה ייראה כמו תוכנה ולא כמו אתר.
 */
function openUrl(url) {
  const candidates = process.platform === 'win32'
    ? appBrowsers().filter(exe => fs.existsSync(exe)) : [];

  const next = (i) => {
    if (i >= candidates.length) return openDefault(url);
    launch(candidates[i], ['--app=' + url, '--window-size=1200,900'], () => next(i + 1));
  };
  next(0);
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
    // התקרה גבוהה כי הלוגו נשלח מוטמע כ-base64; הכל מקומי ממילא
    req.on('data', c => { raw += c; if (raw.length > 8e6) req.destroy(); });
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

module.exports = { start, readState, handle, openUrl, alreadyMine,
                   readBrand, writeBrand, readClient, saveClient, nextSlug, PORT };

if (require.main === module) {
  clearSignals();
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => { clearSignals(); process.exit(0); });
  }
  start({}).then(({ url }) => {
    signal(URL_FILE, url);
    console.log('');
    console.log('  מנוע בדיקת נראות — הממשק פתוח בכתובת:');
    console.log('  ' + url);
    console.log('');
    console.log('  אם החלון לא נפתח לבד, העתק את הכתובת לדפדפן.');
    console.log('  לסגירה: "סגור את התוכנה" בפינת המסך.');
    console.log('');
  }).catch(async (e) => {
    if (e.code === 'EADDRINUSE' && await alreadyMine(PORT)) {
      const url = 'http://127.0.0.1:' + PORT + '/';
      // המשגר מחכה לקובץ הזה, וכאן זו הצלחה ולא כשל
      signal(URL_FILE, url);
      openUrl(url);
      console.log('\n  הממשק כבר פתוח. מחזיר אותך אליו:');
      console.log('  ' + url + '\n');
      return;
    }
    const why = e.code === 'EADDRINUSE'
      ? 'הפורט ' + PORT + ' תפוס על ידי תוכנה אחרת.'
      : e.message;
    console.error('\nלא הצלחתי לפתוח את הממשק: ' + why);
    signal(ERR_FILE, why);
    process.exit(1);
  });
}
