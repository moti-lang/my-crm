'use strict';

const fs = require('fs');
const path = require('path');
const DB = require('./db');
const A = require('./analyze');

const ROOT = path.join(__dirname, '..');
const ENGINE_LABEL = { chatgpt: 'ChatGPT', gemini: 'Gemini', google_aio: 'תשובות AI בגוגל' };

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function pct(x) { return Math.round(x * 100) + '%'; }

/** ניסוח כמות בעברית תקינה: "מנוע אחד" ולא "1 מנועים" */
function count(n, one, many) { return n === 1 ? one : n + ' ' + many; }

function buildHtml(client, run, rows, s) {
  const verdict = s.score >= 70
    ? 'נראות טובה. המיקוד הוא שמירה על המצב והרחבה לשאלות נוספות.'
    : s.score >= 40
      ? 'נראות חלקית. העסק קיים במערכת אבל מפסיד את רוב השאלות למתחרים.'
      : 'נראות נמוכה. ברוב השאלות שלקוח אמיתי שואל, העסק לא עולה כלל.';

  // מיפוי שאלה → מנוע
  const byQ = {};
  for (const r of rows) {
    if (!byQ[r.questionText]) byQ[r.questionText] = {};
    byQ[r.questionText][r.engine] = r;
  }
  const engines = Object.keys(ENGINE_LABEL).filter(e => rows.some(r => r.engine === e));

  const mark = (r) => {
    if (!r) return '·';
    if (r.status === null || r.status === undefined) return '—';
    return r.status === 0 ? '✗' : r.status === 3 ? '★' : r.status === 2 ? '▲' : '•';
  };

  let h = `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<title>דוח נראות — ${esc(client.name)}</title>
<style>
@page{size:A4;margin:14mm}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Arial Hebrew","Noto Sans Hebrew",Arial,sans-serif;color:#12172B;direction:rtl;line-height:1.6;font-size:11pt}
h1{font-size:20pt;font-weight:900}
h2{font-size:14pt;margin-top:18px;margin-bottom:6px}
.muted{color:#5A6379;font-size:10pt}
.score{background:#12172B;color:#fff;border-radius:12px;padding:20px;text-align:center;margin-top:14px}
.score .n{font-size:46pt;font-weight:900;color:#00C2A8;line-height:1}
.score .of{color:#8E9AB4;font-size:10pt;margin-top:4px}
.score .v{color:#D5DCE6;margin-top:10px;font-size:11pt}
.metrics{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
.m{flex:1 1 120px;background:#F4F6F9;border-radius:9px;padding:12px}
.m .n{font-size:18pt;font-weight:900}
.m .l{font-size:9pt;color:#5A6379;margin-top:3px}
.m.hi .n{color:#E07B39}
table{width:100%;border-collapse:collapse;margin-top:10px;font-size:10pt}
th,td{text-align:right;padding:6px 5px;border-bottom:1px solid #DDE3EC;vertical-align:top}
th{font-size:9.5pt;color:#5A6379}
.note{background:#F4F6F9;border-radius:9px;padding:12px;font-size:10pt;color:#5A6379;margin-top:12px}
ul{margin-right:18px}
li{margin-top:4px}
</style></head><body>`;

  h += `<h1>דוח נראות במנועי AI</h1>
<div class="muted">${esc(client.name)} · ${esc(client.trade)} · ${esc(client.city)}${client.city2 ? ' ו' + esc(client.city2) : ''} · ריצה #${run.id} · ${esc((run.started_at || '').slice(0, 10))}</div>`;

  h += `<div class="score"><div class="n">${s.score}</div><div class="of">מתוך 100</div><div class="v">${verdict}</div></div>`;

  h += `<div class="metrics">
<div class="m"><div class="n">${pct(s.pAppear)}</div><div class="l">הופעה בתשובות</div></div>
<div class="m"><div class="n">${pct(s.pTop3)}</div><div class="l">בשלושת הראשונים</div></div>
<div class="m"><div class="n">${pct(s.pDirect)}</div><div class="l">המלצה ישירה</div></div>`;
  // המכפיל הוא יחס בין הופעות המתחרים להופעות העסק. מתחת ל-1 המשמעות הפוכה,
  // ולכן גם המספר וגם הכיתוב מוצגים בכיוון שמתאים למציאות.
  if (s.multiplier === null) {
    h += `<div class="m hi"><div class="n">—</div><div class="l">המתחרים הופיעו ${s.rivalTotal} פעמים, העסק אף פעם</div></div>`;
  } else if (s.multiplier > 1) {
    h += `<div class="m hi"><div class="n">פי ${Math.round(s.multiplier * 10) / 10}</div><div class="l">המתחרים מופיעים יותר ממך</div></div>`;
  } else if (s.multiplier < 1) {
    h += `<div class="m"><div class="n">פי ${Math.round((1 / s.multiplier) * 10) / 10}</div><div class="l">אתה מופיע יותר מהמתחרים</div></div>`;
  } else {
    h += `<div class="m"><div class="n">שוויון</div><div class="l">אתה והמתחרים מופיעים אותו מספר פעמים</div></div>`;
  }
  h += `</div>`;

  const skipped = rows.length - s.measured;
  h += `<div class="note">הבדיקה כללה ${count(Object.keys(byQ).length, 'שאלה אחת', 'שאלות')} על ${count(engines.length, 'מנוע אחד', 'מנועים')}. נמדדו בפועל ${count(s.measured, 'תא אחד', 'תאים')}${skipped > 0 ? ` (${count(skipped, 'תא אחד לא נמדד', 'תאים לא נמדדו')} — לא הוצג בלוק AI או אירעה שגיאה, ואינם נספרים בציון)` : ''}. חישוב הציון: 40% הופעה, 30% מיקום בשלושת הראשונים, 30% המלצה ישירה.</div>`;

  if (s.rivalTally.length) {
    h += `<h2>מי תופס את המקום שלך</h2><table><tr><th>מתחרה</th><th>הופעות</th></tr>`;
    for (const [name, n] of s.rivalTally.slice(0, 10)) h += `<tr><td>${esc(name)}</td><td>${n}</td></tr>`;
    h += `</table>`;
  }

  if (s.sourceTally.length) {
    h += `<h2>מאיפה המודלים שואבים מידע בתחום הזה</h2><table><tr><th>מקור</th><th>ציטוטים</th></tr>`;
    for (const [d, n] of s.sourceTally.slice(0, 12)) h += `<tr><td>${esc(d)}</td><td>${n}</td></tr>`;
    h += `</table><div class="muted" style="margin-top:6px">אלה המקומות שצריך להיות בהם. נוכחות שם משפיעה יותר מכל שינוי באתר.</div>`;
  }

  h += `<h2>פירוט לפי שאלה</h2><table><tr><th>שאלה</th>`;
  for (const e of engines) h += `<th>${esc(ENGINE_LABEL[e])}</th>`;
  h += `</tr>`;
  for (const q of Object.keys(byQ)) {
    h += `<tr><td>${esc(q)}</td>`;
    for (const e of engines) h += `<td style="text-align:center">${mark(byQ[q][e])}</td>`;
    h += `</tr>`;
  }
  h += `</table><div class="muted" style="margin-top:6px">✗ לא מופיע · • מוזכר · ▲ בשלושת הראשונים · ★ מומלץ במפורש · — לא נמדד</div>`;

  if (s.gaps.length) {
    h += `<h2>השאלות שבהן העסק לא מופיע כלל</h2><ul>`;
    for (const g of s.gaps) h += `<li>${esc(g)}</li>`;
    h += `</ul><div class="muted">אלה העדיפויות לעבודה. כל שאלה כזאת היא לקוח שהלך למתחרה.</div>`;
  }

  h += `<h2>הערה על השיטה</h2><div class="muted">הבדיקה בוצעה בצ׳אט זמני ובסביבה מבודדת, כדי למנוע הטיה מהיסטוריית שימוש. תשובות של מודלים משתנות מטבען גם ללא שינוי מצד העסק, ולכן המדידה חוזרת אחת לחודש על אותו מערך שאלות. אין דרך להבטיח הופעה או מיקום בתשובות AI — המטרה היא להגדיל את הסיכוי להופעה ולציטוט.</div>`;

  h += `</body></html>`;
  return h;
}

async function generate(runId, opts) {
  opts = opts || {};
  const db = DB.open();
  const run = DB.getRun(db, runId);
  if (!run) throw new Error('ריצה לא נמצאה: ' + runId);
  const client = DB.getClient(db, run.slug);
  const rows = DB.getRunResults(db, runId);
  db.close();

  if (!rows.length) throw new Error('אין תוצאות בריצה הזאת.');

  const s = A.score(rows);
  const html = buildHtml(client, run, rows, s);

  const dir = path.join(ROOT, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const base = `${client.slug}-run${runId}`;
  const htmlPath = path.join(dir, base + '.html');
  fs.writeFileSync(htmlPath, html, 'utf8');

  let pdfPath = null;
  if (opts.pdf !== false) {
    try {
      const { chromium } = require('playwright');
      const browser = await chromium.launch();
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      pdfPath = path.join(dir, base + '.pdf');
      await page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
      await browser.close();
    } catch (e) {
      console.log('יצירת ה-PDF נכשלה (ה-HTML נוצר בהצלחה): ' + e.message);
    }
  }

  console.log('\nדוח נוצר:');
  console.log('  ' + htmlPath);
  if (pdfPath) console.log('  ' + pdfPath);
  console.log(`\n  ציון: ${s.score}/100 · נמדדו ${s.measured} תאים · הופעה ${pct(s.pAppear)}\n`);
  return { htmlPath, pdfPath, score: s };
}

module.exports = { generate, buildHtml, count };
