'use strict';

/**
 * מבחן-חוזה בין ה-export לכלי הידני.
 *
 * הבאג המקורי היה שתא שלא נמדד יצא בייצוא כ-0 = "לא מופיע".
 * המבחן הזה קורא את פונקציית calc האמיתית מתוך manual-tool/index.html,
 * מריץ אותה על ייצוא אמיתי, ומוודא ש-status:null מטופל כ"לא נמדד"
 * ולא כאפס — גם בתצוגה וגם בציון. אם הייצוא או הכלי יסטו זה מזה, המבחן ייפול.
 *
 * רץ בלי דפדפן ובלי רשת.
 */

const fs = require('fs');
const path = require('path');
const A = require('../src/analyze');
const EXPORT = require('../src/exportJson');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}
function eq(name, got, want) {
  const good = JSON.stringify(got) === JSON.stringify(want);
  if (good) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log(`  ✗ ${name}  קיבלנו: ${JSON.stringify(got)}  ציפינו: ${JSON.stringify(want)}`); }
}

/** חילוץ גוף פונקציה מקוד המקור, לפי ספירת סוגריים מסולסלים */
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '()');
  if (start < 0) throw new Error('לא נמצאה הפונקציה ' + name + ' בכלי הידני');
  let depth = 0, started = false;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') { depth++; started = true; }
    else if (ch === '}') { depth--; if (started && depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('סוגריים לא מאוזנים סביב ' + name);
}

const html = fs.readFileSync(path.join(__dirname, '..', 'manual-tool', 'index.html'), 'utf8');

// calc האמיתי של הכלי, מורץ על state שאנחנו מספקים
const calcSrc = extractFn(html, 'calc');
const runCalc = new Function('state', calcSrc + '\n return calc();');

// רשימת סטטוסים שהכלי יודע להציג בתפריט — כדי לוודא שהייצוא לא פולט ערך לא-קיים
const STATUS = new Function('return ' + html.match(/var STATUS = (\[[\s\S]*?\]);/)[1])();
const optionValues = new Set(STATUS.map(s => String(s.v)));

// נתונים בצורת השורות שה-DB מחזיר. שורות status:null מדמות no_ai_block/שגיאה.
// שאלה Q4 בלי שום שורה — מדמה שאלה שלא התקבלה עליה תוצאה.
const client = {
  name: 'גולד פיש', trade: 'קניית דגים טריים', city: 'ביתר עילית',
  competitors: [{ name: 'בית הקרפיון' }],
  questions: [{ text: 'Q1' }, { text: 'Q2' }, { text: 'Q3' }, { text: 'Q4' }]
};
const rows = [
  { questionText: 'Q1', engine: 'chatgpt',    status: 3,    rivals: ['בית הקרפיון'], sources: ['b144.co.il'] },
  { questionText: 'Q1', engine: 'gemini',     status: 2,    rivals: [], sources: [] },
  { questionText: 'Q1', engine: 'google_aio', status: null, rivals: [], sources: [] },
  { questionText: 'Q2', engine: 'chatgpt',    status: 0,    rivals: [], sources: [] },
  { questionText: 'Q2', engine: 'gemini',     status: 1,    rivals: [], sources: [] },
  { questionText: 'Q2', engine: 'google_aio', status: null, rivals: [], sources: [] },
  { questionText: 'Q3', engine: 'chatgpt',    status: 0,    rivals: [], sources: [] },
  { questionText: 'Q3', engine: 'gemini',     status: null, rivals: [], sources: [] },
  { questionText: 'Q3', engine: 'google_aio', status: 0,    rivals: [], sources: [] }
];

const exp = EXPORT.buildExport(client, rows);

console.log('\n— מבנה הייצוא —');
eq('4 שאלות בייצוא (כולל שאלה בלי תוצאות)', exp.questions.length, 4);
ok('לכל שאלה בדיוק 3 תאים', exp.questions.every(q => q.cells.length === 3));
ok('rivals תמיד מחרוזת (אחרת split בכלי יקרוס)', exp.questions.every(q => q.cells.every(c => typeof c.rivals === 'string')));
ok('source תמיד מחרוזת', exp.questions.every(q => q.cells.every(c => typeof c.source === 'string')));
const q4 = exp.questions[3];
ok('שאלה בלי תוצאות — כל התאים null', q4.cells.every(c => c.status === null));
ok('שאלה בלי תוצאות — כל התאים measured:false', q4.cells.every(c => c.measured === false));
ok('כל status בייצוא הוא אופציה קיימת בתפריט הכלי', exp.questions.every(q => q.cells.every(c => {
  const v = (c.status === null || c.status === undefined) ? '' : String(c.status);
  return optionValues.has(v);
})));

console.log('\n— calc האמיתי של הכלי על הייצוא —');
const nulls = exp.questions.reduce((n, q) => n + q.cells.filter(c => c.status === null).length, 0);
const measured = exp.questions.length * 3 - nulls;
const r = runCalc(exp);
eq(`הכלי מדלג על ${nulls} תאים לא-נמדדים`, r.skipped, nulls);
eq(`הכלי סופר ${measured} תאים נמדדים בלבד`, r.total, measured);
ok('הכלי לא ספר את ה-null כאפס (total < כל התאים)', r.total < exp.questions.length * 3);
eq('ציון הכלי = 35 (עוגן מחושב ידנית)', r.score, 35);
eq('שאלת הפער בכלי = Q3 בלבד', r.gaps, ['Q3']);

console.log('\n— התאמה בין geo-engine לכלי —');
const geo = A.score(rows);
eq('ציון geo-engine == ציון הכלי', geo.score, r.score);
eq('מונה הנמדדים זהה', geo.measured, r.total);
eq('שאלות הפער זהות', geo.gaps, r.gaps);

console.log(`\n${pass} עברו, ${fail} נכשלו\n`);
process.exit(fail ? 1 : 0);
