'use strict';

/**
 * בדיקות ללוגיקה הטהורה — רצות בלי דפדפן ובלי רשת.
 * הרצה: npm test
 */

const N = require('../src/normalize');
const A = require('../src/analyze');
const E = require('../src/exportJson');

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

console.log('\n— מיקום לפי מבנה רשימה —');

// הלקוח שביעי ברשימה, ואף אחד מהשישה שלפניו אינו מתחרה מוגדר.
// בלי זיהוי רשימה זה היה יוצא "מקום 1" ובשלושת הראשונים.
const list7 = `הנה 7 חנויות דגים מומלצות באזור:
1. דגי הים התיכון
2. מרכז הדגים המרכזי
3. חנות הדגה של יוסי
4. דגי צפון
5. הדייג הקטן
6. דגי המושבה
7. גולד פיש`;
const a7 = A.analyzeCell(list7, CLIENT, RIVALS);
eq('שביעי ברשימה → position 7', a7.position, 7);
eq('שביעי ברשימה → status 1 ולא 2', a7.status, 1);
eq('המיקום נגזר מהרשימה', a7.positionBasis, 'list');

const list2 = `1. בית הקרפיון
2. גולד פיש
3. דגי הבירה`;
eq('שני ברשימה → position 2', A.analyzeCell(list2, CLIENT, RIVALS).position, 2);
eq('רשימה ממוספרת ברצף אחד מזוהה', A.listItems(t1).length, 3);
eq('טקסט בלי רשימה לא מזוהה כרשימה', A.listItems('סתם משפט אחד בלי שום רשימה.').length, 0);
eq('בלי רשימה — המיקום נגזר ממתחרים', A.analyzeCell(t2, CLIENT, RIVALS).positionBasis, 'rivals');

console.log('\n— המלצה מפורשת מיוחסת לעסק הנכון —');

const rec1 = 'הכי מומלץ באזור זה דגי הים התיכון, ומיד אחריו גולד פיש ואחר כך דגי צפון.';
const ar1 = A.analyzeCell(rec1, CLIENT, RIVALS);
eq('ההמלצה על עסק אחר → לא status 3', ar1.status !== 3, true);
eq('ההמלצה על עסק אחר → אין recommendHint', ar1.recommendHint, false);

const rec2 = 'ההמלצה שלי היא דגי הים התיכון. אפשרות נוספת היא גולד פיש.';
eq('המלצה במשפט אחר → לא status 3', A.analyzeCell(rec2, CLIENT, RIVALS).status !== 3, true);

const rec3 = 'ההמלצה שלי היא בית הקרפיון ולא גולד פיש.';
eq('שם מתחרה בין הניסוח ללקוח → לא status 3', A.analyzeCell(rec3, CLIENT, RIVALS).status !== 3, true);

const rec4 = 'הייתי ממליץ על גולדפיש בביתר עילית.';
eq('המלצה ישירה על הלקוח (בווריאציה) → status 3', A.analyzeCell(rec4, CLIENT, RIVALS).status, 3);

console.log('\n— ניסוחי המלצה מריצה אמיתית —');

// כל הטקסטים כאן הם ציטוטים מתשובות ChatGPT אמיתיות בריצה #1 מול גולד פיש.
// הרשימה המקורית של ניסוחי ההמלצה החמיצה ארבע מתוך ארבע, כי המודל
// כמעט לא משתמש ב"הכי מומלץ" אלא בניסוחים אישיים.
const REAL = [
  ['הייתי שם את X במקום הראשון',
   'אם אתה מחפש דגים טריים ממש בביתר עילית, הייתי שם את גולד פיש דגים עופות ובקר במקום הראשון כרגע.', 3],
  ['הבחירה שלי: X',
   'הבחירה שלי: גולד פיש, במיוחד אם חשוב לך לקנות דג טרי ולקבל אותו נקי.', 3],
  ['בשורה התחתונה הייתי מתחיל עם X',
   'בשורה התחתונה: לדג טרי ואיכותי הייתי מתחיל עם גולד פיש, ואם אתה רוצה להשוות מחירים — בודק גם את יוסף דגים.', 3]
];
for (const [name, text, want] of REAL) {
  eq(name, A.analyzeCell(text, CLIENT, RIVALS).status, want);
}

// המלצה שחולקה עם מתחרה אינה המלצה בלעדית
eq('"X או מתחרה" אינה המלצה מפורשת',
   A.analyzeCell('אם חשוב לך דווקא בתוך ביתר, הייתי מתחיל מ־גולד פיש או בית הקרפיון.', CLIENT, RIVALS).status, 2);
ok('מקף עברי מנוקה בנרמול', N.tight('גולד־פיש') === N.tight('גולד פיש'));

// אזכור אגבי אחרי שעסק אחר קיבל את הבמה אינו "בשלושת הראשונים"
const casual = A.analyzeCell(
  'ברמי לוי מהדרין בביתר עילית מופיע דניס שלם ב־49.90 ש"ח לקילו. יש גם את גולד פיש שמציעים דגים טריים.',
  CLIENT, RIVALS);
ok('אזכור אגבי אינו מגיע ל-3', casual.status !== 3, JSON.stringify(casual));

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

console.log('\n— ייצוא לכלי הידני —');

const EXP_CLIENT = {
  name: 'גולד פיש', trade: 'דגים', city: 'ביתר עילית',
  competitors: [{ name: 'בית הקרפיון' }],
  questions: [{ text: 'ש1' }, { text: 'ש2' }]
};
const EXP_ROWS = [
  { questionText: 'ש1', engine: 'chatgpt', status: 0, rivals: ['בית הקרפיון'], sources: ['b144.co.il'] },
  { questionText: 'ש1', engine: 'google_aio', status: null, rivals: [], sources: [] }
];
const exp = E.buildExport(EXP_CLIENT, EXP_ROWS);
const cells1 = exp.questions[0].cells;
eq('תא שנמדד כלא-מופיע נשאר 0', cells1[0].status, 0);
eq('תא שנמדד מסומן measured', cells1[0].measured, true);
eq('תא שלא נמדד יוצא null ולא 0', cells1[1].status, null);
eq('תא שלא נמדד מסומן כלא-נמדד', cells1[1].measured, false);
eq('מנוע שלא רץ כלל יוצא null', cells1[2].status, null);
eq('שאלה בלי תוצאות בכלל נשארת בייצוא', exp.questions.length, 2);
eq('שאלה בלי תוצאות — כל התאים null', exp.questions[1].cells.map(c => c.status), [null, null, null]);
eq('מקור נשמר בייצוא', cells1[0].source, 'b144.co.il');

console.log('\n— דף האימות —');
const RV = require('../src/review');

const RVCLIENT = { name: 'גולד פיש', nameVariants: ['גולדפיש', 'Gold Fish'],
                   competitors: [{ name: 'בית הקרפיון', variants: ['הקרפיון'] }] };
const RVTEXT = 'דגי השרון ידועים, ואפשר גם גולדפיש. בית הקרפiון… בית הקרפיון במאה שערים.';
const marked = RV.highlight(RVTEXT, RVCLIENT, RVCLIENT.competitors);
ok('שם הלקוח מסומן גם בווריאציה צמודה', marked.indexOf('<mark class="me">גולדפיש</mark>') !== -1);
ok('מתחרה מסומן בנפרד', marked.indexOf('<mark class="rival">בית הקרפיון</mark>') !== -1);
ok('עסק לא מוכר אינו מסומן', marked.indexOf('<mark class="me">דגי השרון') === -1
                          && marked.indexOf('<mark class="rival">דגי השרון') === -1);
ok('התאמה חוצה רווחים', RV.nameRegex('גולד פיש', []).test('קניתי בגולדפיש אתמול'));
ok('סימון בורח מתגיות HTML', RV.highlight('<script>x</script>', { name: 'ש', nameVariants: [] }, [])
     .indexOf('&lt;script&gt;') !== -1);

eq('פענוח --set תקין', RV.parseSet('12:2,13:n,14:0'),
   [{ id: 12, status: 2 }, { id: 13, status: null }, { id: 14, status: 0 }]);
let threw = false;
try { RV.parseSet('12:9'); } catch (e) { threw = true; }
ok('סטטוס מחוץ לטווח נדחה', threw);
threw = false;
try { RV.parseSet(''); } catch (e) { threw = true; }
ok('--set ריק נדחה', threw);

console.log('\n— דומיינים —');
eq('סינון דומיינים של המנועים עצמם',
   N.domainsOf(['https://www.b144.co.il/x', 'https://chatgpt.com/y', 'https://zap.co.il/z']),
   ['b144.co.il', 'zap.co.il']);

// שרתי מפות נגררים מווידג׳טים ואינם מקורות מידע. בטבלה ללקוח הם רעש.
eq('שרתי מפות ואריחים מסוננים',
   N.domainsOf(['https://api.mapbox.com/tiles/1', 'https://tile.openstreetmap.org/2',
                'https://goldfishbeitar.co.il/', 'https://oaiusercontent.com/z']),
   ['goldfishbeitar.co.il']);
ok('דומיין עסקי רגיל אינו מסונן', !N.isInfra('b144.co.il') && !N.isInfra('pricez.co.il'));
ok('תת-דומיין של תשתית מסונן', N.isInfra('api.mapbox.com'));
ok('דומיין שרק מסתיים דומה אינו מסונן', !N.isInfra('notmapbox.com'));

// ריצות שנשמרו לפני הרחבת הסינון מכילות שרתי מפות. הדוח חייב לנקות אותן.
const sInfra = A.score([
  { status: 2, questionText: 'ש', rivals: [], sources: ['mapbox.com', 'b144.co.il', 'openstreetmap.org'] }
]);
eq('מקורות תשתית שכבר נשמרו מסוננים בדוח', sInfra.sourceTally.map(x => x[0]), ['b144.co.il']);

console.log('\n— כיתוב המכפיל בדוח —');
const REPORT = require('../src/report');
function multLabel(rows) {
  const s = A.score(rows);
  const h = REPORT.buildHtml({ name: 'ע', trade: 'ת', city: 'ע', competitors: [] },
                             { id: 1, started_at: '2026-01-01' }, rows, s);
  const m = h.match(/<div class="n">([^<]*)<\/div><div class="l">([^<]*מופיע[^<]*)<\/div>/);
  return m ? { n: m[1], l: m[2] } : null;
}
// הלקוח הופיע 2, המתחרים 1 → אסור לכתוב שהמתחרים מופיעים יותר
const less = multLabel([
  { status: 2, questionText: 'ש1', rivals: ['א'], sources: [] },
  { status: 2, questionText: 'ש2', rivals: [],    sources: [] }
]);
ok('כשהעסק מופיע יותר — הכיתוב לא סותר', less && less.l.indexOf('אתה מופיע יותר') !== -1, JSON.stringify(less));
// המתחרים 4, הלקוח 1
const more = multLabel([
  { status: 2, questionText: 'ש1', rivals: ['א','ב','ג','ד'], sources: [] },
  { status: 0, questionText: 'ש2', rivals: [], sources: [] }
]);
ok('כשהמתחרים מופיעים יותר — הכיתוב נכון', more && more.l.indexOf('המתחרים מופיעים יותר') !== -1, JSON.stringify(more));

console.log(`\n${pass} עברו, ${fail} נכשלו\n`);
process.exit(fail ? 1 : 0);
