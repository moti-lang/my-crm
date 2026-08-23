'use strict';

const fs = require('fs');
const path = require('path');
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

  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext(CONTEXT_OPTS);
  const page = await ctx.newPage();
  await page.goto(cfg.url, { waitUntil: 'domcontentloaded' });

  console.log('\n──────────────────────────────────────────');
  console.log(`התחבר ל-${cfg.label} בחלון שנפתח.`);
  console.log('השתמש בחשבון ייעודי לבדיקות — לא בחשבון האישי או העסקי.');
  console.log('כשסיימת והממשק נטען — חזור לכאן ולחץ Enter.');
  console.log('──────────────────────────────────────────\n');

  await new Promise(res => process.stdin.once('data', res));

  const out = path.join(B.ROOT, cfg.authFile);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await ctx.storageState({ path: out });
  console.log('נשמר:', cfg.authFile);
  await browser.close();
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

  const browser = await chromium.launch({ headless: opts.headless === true });

  let done = 0;
  const totalCells = client.questions.length * engines.length;

  try {
    for (const engineKey of engines) {
      const cfg = CFG[engineKey];
      console.log(`\n── ${cfg.label} ──`);
      let ctx;
      try {
        ctx = await makeContext(browser, engineKey);
      } catch (e) {
        console.log('  ✗ ' + e.message);
        continue;
      }

      for (let i = 0; i < client.questions.length; i++) {
        const q = client.questions[i];
        const shot = B.shotPath(runId, engineKey, i);
        process.stdout.write(`  [${++done}/${totalCells}] ${q.text.slice(0, 46)}… `);

        const res = await DRIVERS[engineKey].ask(ctx, cfg, q.text, shot);

        let analysis;
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

        if (i < client.questions.length - 1) await B.pause(20000, 60000);
      }

      await ctx.close();
    }
    DB.finishRun(db, runId, 'done');
  } catch (e) {
    DB.finishRun(db, runId, 'error');
    throw e;
  } finally {
    await browser.close();
    db.close();
  }

  console.log(`\n✓ הריצה הסתיימה. מזהה ריצה: ${runId}`);
  console.log(`  לאימות ידני:  npm run verify -- ${runId}`);
  console.log(`  ליצירת דוח:   npm run report -- ${runId}\n`);
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

module.exports = { run, login, reanalyze, ORDER, CFG };
