'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DB = require('./db');
const R = require('./run');
const REPORT = require('./report');
const A = require('./analyze');

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

/* ---------- ייצוא לכלי הידני ---------- */
function exportJson(runId) {
  const db = DB.open();
  const run = DB.getRun(db, runId);
  if (!run) throw new Error('ריצה לא נמצאה: ' + runId);
  const client = DB.getClient(db, run.slug);
  const rows = DB.getRunResults(db, runId);
  db.close();

  const ENGINES = ['chatgpt', 'gemini', 'google_aio'];
  const byQ = {};
  for (const r of rows) {
    if (!byQ[r.questionText]) byQ[r.questionText] = {};
    byQ[r.questionText][r.engine] = r;
  }

  const out = {
    biz: client.name, trade: client.trade, city: client.city,
    city2: client.city2 || '', extra: client.extra || '',
    competitors: client.competitors.map(c => c.name),
    questions: Object.keys(byQ).map(q => ({
      text: q,
      cells: ENGINES.map(e => {
        const r = byQ[q][e];
        return {
          status: r && r.status !== null ? r.status : 0,
          rivals: r ? (r.rivals || []).join(', ') : '',
          source: r ? (r.sources || [])[0] || '' : ''
        };
      })
    }))
  };

  const dir = path.join(ROOT, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${client.slug}-run${runId}.json`);
  fs.writeFileSync(f, JSON.stringify(out), 'utf8');
  console.log('נוצר: ' + f);
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
      case 'login':      await R.login(args[0] || 'gemini'); break;
      case 'run':        await R.run(args[0], { engine: flags.engine, headless: flags.headless === 'true', notes: flags.notes }); break;
      case 'analyze':    R.reanalyze(parseInt(args[0], 10)); break;
      case 'verify':     await verify(parseInt(args[0], 10)); break;
      case 'report':     await REPORT.generate(parseInt(args[0], 10), { pdf: flags.pdf !== 'false' }); break;
      case 'export':     exportJson(parseInt(args[0], 10)); break;
      case 'runs':       runs(args[0]); break;
      default:
        console.log(`
מנוע בדיקת נראות במנועי AI

  node src/cli.js client:add <קובץ>     טעינת לקוח מקובץ JSON
  node src/cli.js login <gemini>        התחברות חד-פעמית
  node src/cli.js run <slug>            ריצה מלאה
  node src/cli.js run <slug> --engine=chatgpt
  node src/cli.js analyze <run-id>      ניתוח מחדש על טקסט שמור
  node src/cli.js verify <run-id>       מעבר ידני ותיקון
  node src/cli.js report <run-id>       יצירת דוח HTML + PDF
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
module.exports = { clientAdd, verify, exportJson, runs };
