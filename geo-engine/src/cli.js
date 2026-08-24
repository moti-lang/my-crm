'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DB = require('./db');
const R = require('./run');
const REPORT = require('./report');
const EXPORT = require('./exportJson');
const REVIEW = require('./review');

const ROOT = path.join(__dirname, '..');
const ENGINE_LABEL = { chatgpt: 'ChatGPT', gemini: 'Gemini', google_aio: 'תשובות AI בגוגל' };

function ask(rl, q) { return new Promise(res => rl.question(q, a => res(a.trim()))); }

/* ---------- הוספת לקוח מקובץ JSON ---------- */
function clientAdd(file) {
  const p = path.isAbsolute(file) ? file : path.join(ROOT, file);
  if (!fs.existsSync(p)) throw new Error('קובץ לא נמצא: ' + p);
  const c = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!c.slug || !c.name) throw new Error('חסר slug או name בקובץ הלקוח.');
  if (!c.questions || !c.questions.length) throw new Error('חסרות שאלות בקובץ הלקוח.');
  const db = DB.open();
  const id = DB.upsertClient(db, c);
  db.close();
  console.log(`נשמר לקוח "${c.name}" (${c.slug}) עם ${c.questions.length} שאלות ו-${(c.competitors || []).length} מתחרים.`);
  return id;
}

/* ---------- אימות ידני ---------- */
async function verify(runId) {
  const db = DB.open();
  const run = DB.getRun(db, runId);
  if (!run) throw new Error('ריצה לא נמצאה: ' + runId);
  const rows = DB.getRunResults(db, runId);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\nמעבר ידני על התוצאות. Enter = להשאיר כמו שזה, מספר 0-3 = לשנות, s = לדלג לסוף.\n');
  console.log('0 לא מופיע · 1 מוזכר · 2 בשלושת הראשונים · 3 מומלץ במפורש · n לא נמדד\n');

  for (const r of rows) {
    const cur = r.status === null ? 'לא נמדד' : String(r.status);
    console.log(`\n[${ENGINE_LABEL[r.engine] || r.engine}] ${r.questionText}`);
    console.log(`  סימון נוכחי: ${cur}${r.position ? ' (מקום ' + r.position + ')' : ''}`);
    if (r.position && r.position_basis === 'rivals') {
      console.log('  שים לב: המיקום נגזר ממתחרים מוכרים בלבד, לא ממבנה רשימה — בדוק בצילום.');
    }
    if (r.rivals.length) console.log(`  מתחרים שזוהו: ${r.rivals.join(', ')}`);
    if (r.screenshot_path) console.log(`  צילום: ${r.screenshot_path}`);
    const a = await ask(rl, '  > ');
    if (a === 's') break;
    if (a === '') continue;
    if (a === 'n') { DB.updateResult(db, r.id, { status: null }); continue; }
    const v = parseInt(a, 10);
    if (v >= 0 && v <= 3) DB.updateResult(db, r.id, { status: v, position: r.position });
  }
  rl.close();
  db.close();
  console.log('\nהאימות נשמר.\n');
}

/* ---------- פתיחת הדפדפן האמיתי להתחברות ---------- */
async function openBrowser() {
  const out = await R.openRealBrowser('https://gemini.google.com/app');
  console.log('');
  if (out.already) {
    console.log('דפדפן כבר פתוח ומחובר לפורט הניפוי. אין צורך לפתוח שוב.');
  } else {
    console.log(`נפתח ${out.label} בחלון נפרד.`);
  }
  console.log('');
  console.log('──────────────────────────────────────────');
  console.log('1. התחבר בחלון שנפתח לחשבון גוגל הייעודי');
  console.log('2. חכה שממשק Gemini ייטען — עד שאתה רואה את שדה ההקלדה');
  console.log('3. השאר את החלון פתוח. אל תסגור אותו.');
  console.log('4. חזור לכאן והרץ:');
  console.log('');
  console.log('   node src/cli.js run goldfish --engine=gemini --cdp');
  console.log('──────────────────────────────────────────');
  console.log('');
}

/* ---------- דף אימות בדפדפן ---------- */
function review(runId) {
  const out = REVIEW.generate(runId, DB);
  console.log('\nדף האימות נוצר:');
  console.log('  ' + out.file);
  console.log('\nפתח אותו בדפדפן, סמן, והדבק בחזרה את השורה שהוא נותן.\n');
}

/* ---------- החלת סימונים מדף האימות ---------- */
function applySet(runId, spec) {
  const marks = REVIEW.parseSet(spec);
  const db = DB.open();
  const run = DB.getRun(db, runId);
  if (!run) { db.close(); throw new Error('ריצה לא נמצאה: ' + runId); }

  const rows = DB.getRunResults(db, runId);
  const byId = {};
  for (const r of rows) byId[r.id] = r;

  let changed = 0, same = 0;
  for (const m of marks) {
    const r = byId[m.id];
    if (!r) { db.close(); throw new Error('תוצאה ' + m.id + ' אינה שייכת לריצה ' + runId); }
    const before = (r.status === null || r.status === undefined) ? null : r.status;
    if (before === m.status) { same++; }
    else { changed++; }
    // המיקום נשמר רק כשהתוצאה עדיין "בשלושת הראשונים"; אחרת הוא חסר משמעות
    DB.updateResult(db, m.id, { status: m.status, position: m.status === 2 ? r.position : null });
  }
  db.close();
  console.log(`\nהאימות נשמר. ${changed} תוצאות שונו, ${same} אושרו כפי שהן.`);
  console.log(`כל ${marks.length} התוצאות מסומנות עכשיו כמאומתות ידנית.`);
  console.log(`\nליצירת דוח מעודכן:  node src/cli.js report ${runId}\n`);
}

/* ---------- ייצוא לכלי הידני ---------- */
function exportJson(runId) {
  const db = DB.open();
  const run = DB.getRun(db, runId);
  if (!run) throw new Error('ריצה לא נמצאה: ' + runId);
  const client = DB.getClient(db, run.slug);
  const rows = DB.getRunResults(db, runId);
  db.close();

  const out = EXPORT.buildExport(client, rows);

  const dir = path.join(ROOT, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${client.slug}-run${runId}.json`);
  fs.writeFileSync(f, JSON.stringify(out), 'utf8');

  let unmeasured = 0, total = 0;
  for (const q of out.questions) for (const c of q.cells) { total++; if (!c.measured) unmeasured++; }

  console.log('נוצר: ' + f);
  if (unmeasured) {
    console.log(`שים לב: ${unmeasured} מתוך ${total} תאים לא נמדדו והם יוצאים כ-null (לא כאפס).`);
  }
  console.log('הדבק את תוכן הקובץ בשדה הייבוא של הכלי הידני.');
}

/* ---------- רשימת ריצות ---------- */
function runs(slug) {
  const db = DB.open();
  const list = DB.listRuns(db, slug);
  db.close();
  if (!list.length) { console.log('אין ריצות עדיין.'); return; }
  console.log('\nמזהה  לקוח            התחלה               סטטוס');
  for (const r of list) {
    console.log(`${String(r.id).padEnd(5)} ${String(r.slug).padEnd(15)} ${String(r.started_at).padEnd(20)} ${r.status}`);
  }
  console.log('');
}

/* ---------- main ---------- */
async function main() {
  const [, , cmd, ...rest] = process.argv;
  const args = rest.filter(a => !a.startsWith('--'));
  const flags = {};
  for (const a of rest) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      flags[k] = v === undefined ? true : v;
    }
  }

  try {
    switch (cmd) {
      case 'client:add': clientAdd(args[0] || 'clients/example.json'); break;
      case 'browser':    await openBrowser(); break;
      case 'login':      await R.login(args[0] || 'gemini'); break;
      case 'run':        await R.run(args[0], { engine: flags.engine, headless: flags.headless === 'true', notes: flags.notes, cdp: flags.cdp }); break;
      case 'analyze':    R.reanalyze(parseInt(args[0], 10)); break;
      case 'review':     review(parseInt(args[0], 10)); break;
      case 'verify':
        if (flags.set) applySet(parseInt(args[0], 10), flags.set);
        else await verify(parseInt(args[0], 10));
        break;
      case 'report':
        await REPORT.generate(String(args[0] || '').split(',').map(x => parseInt(x, 10)),
                              { pdf: flags.pdf !== 'false',
                                vs: flags.vs ? String(flags.vs).split(',').map(x => parseInt(x, 10)) : null });
        break;
      case 'export':     exportJson(parseInt(args[0], 10)); break;
      case 'runs':       runs(args[0]); break;
      default:
        console.log(`
מנוע בדיקת נראות במנועי AI

  node src/cli.js client:add <קובץ>     טעינת לקוח מקובץ JSON
  node src/cli.js browser              פתיחת הדפדפן שלך להתחברות ל-Gemini
  node src/cli.js run <slug> --engine=gemini --cdp    ריצה דרך הדפדפן שלך
  node src/cli.js login <gemini>        התחברות חד-פעמית (לא עובד מול גוגל)
  node src/cli.js run <slug>            ריצה מלאה
  node src/cli.js run <slug> --engine=chatgpt
  node src/cli.js analyze <run-id>      ניתוח מחדש על טקסט שמור
  node src/cli.js review <run-id>       דף אימות שנפתח בדפדפן (מומלץ)
  node src/cli.js verify <run-id>       מעבר ידני בטרמינל
  node src/cli.js verify <run-id> --set=12:2,13:n   החלת הסימונים מדף האימות
  node src/cli.js report <run-id>       יצירת דוח HTML + PDF
  node src/cli.js report 1,5,7          דוח אחד שמאחד כמה ריצות
  node src/cli.js report 8,9,10 --vs=1,5,7   דוח עם השוואה למדידה קודמת
  node src/cli.js export <run-id>       ייצוא JSON לכלי הידני
  node src/cli.js runs [slug]           רשימת ריצות
`);
    }
  } catch (e) {
    console.error('\n✗ ' + e.message + '\n');
    process.exit(1);
  }
  process.exit(0);
}

if (require.main === module) main();
module.exports = { clientAdd, verify, applySet, review, exportJson, runs };
