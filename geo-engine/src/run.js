'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const DB = require('./db');
const N = require('./normalize');
const A = require('./analyze');
const B = require('./engines/browser');

const CFG = require('../config/engines.json');
const DRIVERS = {
  chatgpt: require('./engines/chatgpt'),
  gemini: require('./engines/gemini'),
  google_aio: require('./engines/googleAio')
};

const ORDER = ['chatgpt', 'gemini', 'google_aio'];

/**
 * גוגל חוסמת התחברות מדפדפן שמזוהה כאוטומטי ומציגה
 * "הדפדפן הזה אולי אינו מאובטח". דפדפן אמיתי מותקן עובר את זה הרבה יותר טוב
 * מהכרומיום המצומצם ש-Playwright מוריד. מנסים לפי הסדר ולוקחים את הראשון שקיים.
 */
const CHANNELS = ['chrome', 'msedge', null];

/* ==========================================================
   חיבור לדפדפן אמיתי (CDP)

   גוגל חוסמת התחברות מדפדפן ש-Playwright פותח, ומציגה
   "ייתכן שהדפדפן או האפליקציה לא מאובטחים". אי אפשר לעקוף את זה
   מבפנים, וגם לא כדאי לנסות.

   הפתרון: לא לפתוח דפדפן דרך Playwright בכלל. פותחים את Chrome או Edge
   האמיתי שמותקן במחשב, עם פורט ניפוי, המשתמש מתחבר בו כרגיל —
   וזה דפדפן רגיל לכל דבר, כי הוא באמת רגיל — ורק אז המנוע מתחבר אליו
   מבחוץ ומנהג אותו.
   ========================================================== */

const CDP_PORT = 9222;

const REAL_BROWSERS = [
  ['Chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'],
  ['Chrome', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'],
  ['Chrome', process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : ''],
  ['Edge',   'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'],
  ['Edge',   'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'],
  ['Chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  ['Chrome', '/usr/bin/google-chrome'],
  ['Chromium', '/usr/bin/chromium']
];

/** מאתר דפדפן אמיתי מותקן */
function findRealBrowser() {
  for (const [label, p] of REAL_BROWSERS) {
    if (p && fs.existsSync(p)) return { label, path: p };
  }
  return null;
}

/** האם פורט הניפוי כבר מאזין */
function portOpen(port) {
  return new Promise(res => {
    const sock = net.connect({ host: '127.0.0.1', port }, () => { sock.end(); res(true); });
    sock.on('error', () => res(false));
    sock.setTimeout(1200, () => { sock.destroy(); res(false); });
  });
}

/**
 * פותח את הדפדפן האמיתי עם פורט ניפוי ומשאיר אותו פתוח.
 * מפעילים פעם אחת, מתחברים ידנית, ומשאירים פתוח לריצות.
 */
async function openRealBrowser(startUrl) {
  if (await portOpen(CDP_PORT)) {
    return { already: true, label: 'דפדפן שכבר פתוח' };
  }

  const found = findRealBrowser();
  if (!found) {
    throw new Error('לא נמצא Chrome או Edge מותקן במחשב.\nהתקן Chrome מ- https://www.google.com/chrome ואז הרץ שוב.');
  }

  // Chrome מסרב לפתוח פורט ניפוי על הפרופיל הרגיל, ולכן פרופיל נפרד — וזה גם נכון:
  // ההתחברות לבדיקות נשארת מופרדת לגמרי מהדפדפן היומיומי שלך.
  const profileDir = path.join(B.ROOT, 'data', 'browser-profile');
  fs.mkdirSync(profileDir, { recursive: true });

  const args = [
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=' + profileDir,
    '--no-first-run',
    '--no-default-browser-check',
    '--restore-last-session'
  ];
  if (startUrl) args.push(startUrl);

  const child = spawn(found.path, args, { detached: true, stdio: 'ignore' });
  child.unref();

  for (let i = 0; i < 40; i++) {
    if (await portOpen(CDP_PORT)) return { already: false, label: found.label, profileDir };
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('הדפדפן נפתח אבל פורט הניפוי לא נענה.\nסגור את כל חלונות ' + found.label + ' והרץ שוב.');
}

/** מתחבר לדפדפן שכבר פתוח */
async function R_connect() {
  if (!(await portOpen(CDP_PORT))) {
    throw new Error('לא נמצא דפדפן פתוח לחיבור.\nהרץ קודם:  node src/cli.js browser');
  }
  return chromium.connectOverCDP('http://127.0.0.1:' + CDP_PORT);
}

/**
 * בודק איזה דפדפן זמין בפועל, בהרצה קצרה ומוסתרת.
 * חייב להיות נפרד מהפתיחה האמיתית: ניסיון שנכשל על תיקיית פרופיל
 * עלול לנעול אותה ולהפיל גם את הניסיונות הבאים על אותה תיקייה.
 */
async function pickChannel() {
  const tried = [];
  for (const ch of CHANNELS) {
    const o = { headless: true };
    if (ch) o.channel = ch;
    try {
      const b = await chromium.launch(o);
      await b.close();
      return { channel: ch, label: ch || 'chromium', tried };
    } catch (e) {
      tried.push((ch || 'chromium') + ': ' + String(e.message).split('\n')[0]);
    }
  }
  const err = new Error('לא נמצא דפדפן שאפשר להפעיל.\n  ' + tried.join('\n  ')
    + '\n\nהרץ: npx playwright install chromium');
  err.noBrowser = true;
  throw err;
}

const CONTEXT_OPTS = {
  locale: 'he-IL',
  timezoneId: 'Asia/Jerusalem',
  viewport: { width: 1280, height: 1000 },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
};

async function makeContext(browser, engineKey) {
  const cfg = CFG[engineKey];
  const opts = Object.assign({}, CONTEXT_OPTS);
  if (cfg.authFile) {
    const f = path.join(B.ROOT, cfg.authFile);
    if (fs.existsSync(f)) opts.storageState = f;
    else if (cfg.requiresLogin) {
      throw new Error(`חסר קובץ התחברות ל-${cfg.label}. הרץ: npm run login -- ${engineKey}`);
    }
  }
  return browser.newContext(opts);
}

/** התחברות חד-פעמית — נפתח דפדפן, המשתמש מתחבר ידנית, ה-session נשמר */
async function login(engineKey) {
  const cfg = CFG[engineKey];
  if (!cfg) throw new Error('מנוע לא מוכר: ' + engineKey);
  if (!cfg.authFile) { console.log(`${cfg.label} לא דורש התחברות.`); return; }

  // פרופיל קבוע על הדיסק. גוגל סומכת עליו הרבה יותר מחלון חד-פעמי,
  // והוא גם שומר את ההתחברות בין ריצות.
  const profileDir = path.join(B.ROOT, 'data', 'profile-' + engineKey);
  fs.mkdirSync(profileDir, { recursive: true });

  const picked = await pickChannel();
  const opts = Object.assign({ headless: false }, CONTEXT_OPTS);
  if (picked.channel) opts.channel = picked.channel;

  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(profileDir, opts);
  } catch (e) {
    throw new Error('לא הצלחתי לפתוח דפדפן להתחברות (' + picked.label + '):\n  '
      + String(e.message).split('\n')[0]
      + '\n\nאם התיקייה נעולה מריצה קודמת — סגור חלונות דפדפן פתוחים,'
      + '\nאו מחק את התיקייה ' + profileDir + ' והרץ שוב.');
  }
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(cfg.url, { waitUntil: 'domcontentloaded' });

  console.log('\n──────────────────────────────────────────');
  console.log(`התחבר ל-${cfg.label} בחלון שנפתח.`);
  console.log(`הדפדפן שנפתח: ${picked.label}`);
  console.log('השתמש בחשבון ייעודי לבדיקות — לא בחשבון האישי או העסקי.');
  console.log('');
  console.log('אם גוגל אומרת "הדפדפן הזה אולי אינו מאובטח" —');
  console.log('התחבר קודם בדפדפן הרגיל שלך לחשבון הזה, ואז נסה שוב כאן.');
  console.log('');
  console.log('כשסיימת והממשק של Gemini נטען — חזור לכאן ולחץ Enter.');
  console.log('──────────────────────────────────────────\n');

  await new Promise(res => process.stdin.once('data', res));

  const out = path.join(B.ROOT, cfg.authFile);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await ctx.storageState({ path: out });

  // בדיקה שההתחברות באמת נתפסה, במקום לגלות את זה רק בעוד 15 דקות
  const state = JSON.parse(fs.readFileSync(out, 'utf8'));
  const cookies = (state.cookies || []).filter(c => /google\.com$/.test(String(c.domain).replace(/^\./, '')));
  if (!cookies.length) {
    console.log('\n⚠ לא נשמרו עוגיות של גוגל. כנראה ההתחברות לא הושלמה.');
    console.log('  הרץ שוב את הפקודה, והפעם ודא שממשק Gemini נטען לפני שאתה לוחץ Enter.\n');
  } else {
    console.log(`\n✓ נשמר: ${cfg.authFile} (${cookies.length} עוגיות של גוגל)\n`);
  }
  await ctx.close();
}

/** ריצה מלאה */
async function run(slug, opts) {
  opts = opts || {};
  const db = DB.open();
  const client = DB.getClient(db, slug);
  if (!client) throw new Error('לקוח לא נמצא: ' + slug + ' — הרץ קודם: npm run client:add');
  if (!client.questions.length) throw new Error('אין שאלות פעילות ללקוח הזה.');

  const engines = opts.engine ? [opts.engine] : ORDER;
  for (const e of engines) if (!CFG[e]) throw new Error('מנוע לא מוכר: ' + e);

  const runId = DB.newRun(db, client.id, opts.notes);
  console.log(`\n▶ ריצה #${runId} · ${client.name} · ${client.questions.length} שאלות × ${engines.length} מנועים\n`);

  // cdp: מתחבר לדפדפן האמיתי שכבר פתוח ומחובר, במקום לפתוח דפדפן משלנו.
  // זה המסלול היחיד שעובד מול Gemini, כי גוגל חוסמת דפדפן שנפתח אוטומטית.
  const useCdp = opts.cdp === true || opts.cdp === 'true';
  let browser, sharedCtx = null;

  if (useCdp) {
    // אם הדפדפן לא פתוח — פותחים אותו במקום להיכשל. הפרופיל קבוע,
    // ולכן ההתחברות מהפעם הקודמת אמורה להיות שם כבר.
    if (!(await portOpen(CDP_PORT))) {
      console.log('  הדפדפן לא פתוח. פותח אותו עכשיו…');
      const opened = await openRealBrowser('https://gemini.google.com/app');
      console.log(`  נפתח ${opened.label}.`);
      console.log('');
      console.log('  ודא שאתה מחובר ושממשק Gemini נטען, ואז חזור לכאן.');
      console.log('  (אם אתה כבר מחובר מהפעם הקודמת — פשוט לחץ Enter)');
      await new Promise(res => process.stdin.once('data', res));
    }
    browser = await R_connect();
    sharedCtx = browser.contexts()[0];
    if (!sharedCtx) throw new Error('הדפדפן פתוח אבל אין בו חלון. פתח לשונית והרץ שוב.');
    console.log('  דפדפן: מחובר לדפדפן שלך\n');
  } else {
    const picked = await pickChannel();
    const launchOpts = { headless: opts.headless === true };
    if (picked.channel) launchOpts.channel = picked.channel;
    browser = await chromium.launch(launchOpts);
    console.log(`  דפדפן: ${picked.label}\n`);
  }

  let done = 0;
  const totalCells = client.questions.length * engines.length;

  try {
    for (const engineKey of engines) {
      const cfg = CFG[engineKey];
      console.log(`\n── ${cfg.label} ──`);
      let ctx;
      if (sharedCtx) {
        ctx = sharedCtx;
      } else {
        try {
          ctx = await makeContext(browser, engineKey);
        } catch (e) {
          console.log('  ✗ ' + e.message);
          continue;
        }
      }

      let blockedStreak = 0;
      for (let i = 0; i < client.questions.length; i++) {
        const q = client.questions[i];
        const shot = B.shotPath(runId, engineKey, i);
        process.stdout.write(`  [${++done}/${totalCells}] ${q.text.slice(0, 46)}… `);

        const res = await DRIVERS[engineKey].ask(ctx, cfg, q.text, shot);

        let analysis;
        if (res.blocked) blockedStreak++; else if (!res.error) blockedStreak = 0;

        if (res.error) {
          analysis = { status: null, position: null, positionBasis: null, rivalsFound: [] };
          console.log('שגיאה: ' + res.error.slice(0, 60));
        } else if (res.absent) {
          analysis = { status: null, position: null, positionBasis: null, rivalsFound: [] };
          console.log('לא הוצג בלוק AI (נרשם כלא-נמדד)');
        } else {
          analysis = A.analyzeCell(res.text, { name: client.name, variants: client.nameVariants }, client.competitors);
          const label = analysis.status === 0 ? 'לא מופיע'
            : analysis.status === 3 ? 'מומלץ במפורש'
            : analysis.status === 2 ? `מקום ${analysis.position}`
            : 'מוזכר';
          console.log(label);
        }

        DB.saveResult(db, {
          runId, questionId: q.id, engine: engineKey,
          rawText: res.text, screenshotPath: shot,
          status: analysis.status, position: analysis.position,
          positionBasis: analysis.positionBasis,
          rivals: analysis.rivalsFound,
          sources: N.domainsOf(res.urls),
          error: res.error || (res.absent ? 'no_ai_block' : null)
        });

        // שלוש חסימות ברצף — אין טעם להמשיך, וכל השאר יירשמו כלא-נמדדים
        if (blockedStreak >= 3) {
          console.log('');
          console.log(`  ✗ ${cfg.label} חסם אותנו שלוש פעמים ברצף. מפסיק כאן.`);
          console.log('    השאלות שנותרו לא נמדדו ואינן נספרות בציון.');
          console.log('    נסה שוב מאוחר יותר, או הרץ עם --cdp דרך הדפדפן שלך.');
          console.log('');
          break;
        }

        if (i < client.questions.length - 1) await B.pause(20000, 60000);
      }

      // בחיבור CDP זה הדפדפן של המשתמש — לא סוגרים אותו
      if (!sharedCtx) await ctx.close();
    }
    DB.finishRun(db, runId, 'done');
  } catch (e) {
    DB.finishRun(db, runId, 'error');
    throw e;
  } finally {
    // בחיבור CDP רק מתנתקים; הדפדפן נשאר פתוח כדי שההתחברות תישמר לריצה הבאה
    if (useCdp) { try { await browser.close(); } catch (e) { /* ניתוק בלבד */ } }
    else { await browser.close(); }
    db.close();
  }

  console.log(`\n✓ הריצה הסתיימה. מזהה ריצה: ${runId}`);
  console.log(`  לאימות ידני:  node src/cli.js review ${runId}`);
  console.log(`  ליצירת דוח:   node src/cli.js report ${runId}\n`);
  return runId;
}

/** ניתוח מחדש על טקסט שכבר נשמר — בלי לפנות שוב למנועים */
function reanalyze(runId) {
  const db = DB.open();
  const run = DB.getRun(db, runId);
  if (!run) throw new Error('ריצה לא נמצאה: ' + runId);
  const client = DB.getClient(db, run.slug);
  const rows = DB.getRunResults(db, runId);

  let changed = 0;
  for (const r of rows) {
    if (r.error === 'no_ai_block' || (r.error && !r.raw_text)) continue;
    const a = A.analyzeCell(r.raw_text, { name: client.name, variants: client.nameVariants }, client.competitors);
    if (a.status !== r.status) changed++;
    db.prepare('UPDATE results SET status=?, position=?, position_basis=?, rivals_found=? WHERE id=?')
      .run(a.status, a.position, a.positionBasis, JSON.stringify(a.rivalsFound), r.id);
  }
  db.close();
  console.log(`ניתוח מחדש הושלם. ${changed} תוצאות השתנו.`);
}

module.exports = { run, login, reanalyze, openRealBrowser, connectRealBrowser: R_connect, findRealBrowser, portOpen, CDP_PORT, ORDER, CFG };
