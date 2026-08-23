'use strict';

/**
 * בדיקות ללוגיקה הטהורה — רצות בלי דפדפן ובלי רשת.
 * הרצה: npm test
 */

const N = require('../src/normalize');
const A = require('../src/analyze');

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

const CLIENT = { name: 'גולד פיש', variants: ['גולדפיש', 'גולד שיווק', 'Gold Fish'] };
const RIVALS = [
  { name: 'בית הקרפיון', variants: ['הקרפיון'] },
  { name: 'דגי הבירה', variants: [] }
];

console.log('\n— נרמול והתאמת שמות —');
ok('גרשיים יורדים', N.norm('בד"ץ') === 'בדץ');
ok('רווחים מתאחדים', N.norm('גולד   פיש') === 'גולד פיש');
ok('התאמה צמודה: גולדפיש = גולד פיש', N.tight('גולדפיש') === N.tight('גולד פיש'));
ok('וריאציה מזוהה', N.mentions('קניתי אתמול בגולדפיש', 'גולד פיש', ['גולדפיש']));
ok('אות שימוש בתחילת שם', N.mentions('הלכתי לגולד פיש', 'גולד פיש', []));
ok('שם מומצא לא מזוהה', !N.mentions('טקסט כלשהו בלי שום שם', 'עסק שלא קיים', []));

console.log('\n— ניתוח תא —');

let t1 = 'הנה כמה אפשרויות: 1. בית הקרפיון — מאה שערים. 2. גולד פיש — ביתר עילית. 3. דגי הבירה.';
let a1 = A.analyzeCell(t1, CLIENT, RIVALS);
eq('מיקום 2 → status 2', a1.status, 2);
eq('position = 2', a1.position, 2);
eq('שני מתחרים זוהו', a1.rivalsFound.length, 2);

let t2 = 'ההמלצה שלי היא גולד פיש בביתר עילית, שם תמצא דגים טריים.';
let a2 = A.analyzeCell(t2, CLIENT, RIVALS);
eq('ראשון + ניסוח המלצה → status 3', a2.status, 3);

let t3 = 'בית הקרפיון, דגי הבירה, ועוד כמה חנויות באזור.';
let a3 = A.analyzeCell(t3, CLIENT, RIVALS);
eq('לא מופיע → status 0', a3.status, 0);
eq('אין position', a3.position, null);

let a4 = A.analyzeCell('', CLIENT, RIVALS);
eq('טקסט ריק → status null (לא נמדד)', a4.status, null);

let t5 = 'אפשרויות: בית הקרפיון, דגי הבירה, חנות א, חנות ב, וגם גולדפיש בביתר.';
let a5 = A.analyzeCell(t5, CLIENT, RIVALS);
eq('מוזכר אחרי 2 מתחרים ידועים → status 2 או 1', a5.status >= 1, true);

console.log('\n— חישוב ציון —');

const rows = [
  { status: 3, questionText: 'ש1', rivals: ['בית הקרפיון'], sources: ['b144.co.il'] },
  { status: 0, questionText: 'ש1', rivals: ['בית הקרפיון'], sources: ['b144.co.il'] },
  { status: 2, questionText: 'ש2', rivals: [], sources: ['dapey-zahav.co.il'] },
  { status: 0, questionText: 'ש3', rivals: ['דגי הבירה'], sources: [] },
  { status: null, questionText: 'ש3', rivals: [], sources: [] }
];
const s = A.score(rows);
eq('נמדדו 4 תאים (ה-null לא נספר)', s.measured, 4);
eq('הופעה 2 מתוך 4', s.appear, 2);
eq('בשלושת הראשונים 2', s.top3, 2);
eq('המלצה ישירה 1', s.direct, 1);
eq('ציון = 42', s.score, Math.round(100 * (0.4 * 0.5 + 0.3 * 0.5 + 0.3 * 0.25)));
eq('מקור מוביל b144', s.sourceTally[0][0], 'b144.co.il');
eq('מתחרה מוביל בית הקרפיון', s.rivalTally[0][0], 'בית הקרפיון');
eq('פער בשאלה 3', s.gaps, ['ש3']);

const sNone = A.score([{ status: 0, questionText: 'ש', rivals: ['א', 'ב'], sources: [] }]);
eq('לא הופיע כלל → אין מכפלה', sNone.multiplier, null);

console.log('\n— דומיינים —');
eq('סינון דומיינים של המנועים עצמם',
   N.domainsOf(['https://www.b144.co.il/x', 'https://chatgpt.com/y', 'https://zap.co.il/z']),
   ['b144.co.il', 'zap.co.il']);

console.log(`\n${pass} עברו, ${fail} נכשלו\n`);
process.exit(fail ? 1 : 0);
