#!/usr/bin/env node
/**
 * ★ הכלל: בדיקה לא מחפשת מחרוזת שיכולה להופיע בהערה.
 *
 * זה קרה שש פעמים, לשני הכיוונים:
 *   · חיובית עוברת כי המילה שרדה בהערה אחרי שהקוד נמחק
 *     (AbortController — הקוד הוסר, ההערה נשארה, הבדיקה עברה).
 *   · שלילית נכשלת כי הערה מזכירה את מה שאסור להיות בקוד.
 *
 * האכיפה: אף קובץ בדיקה לא קורא קובץ מקור ישירות. הכל עובר דרך
 * _code.mjs — codeOf (בלי הערות) או rawOf (מפורש, כשהטקסט עצמו נבדק).
 * הכלל ניתן לבדיקה חד-משמעית, בניגוד ל"האם ההערה הזאת מסוכנת".
 *
 * ובנוסף: המסיר עצמו נבדק. הוא נושא עכשיו עשרות טענות, ומסיר שגוי
 * היה מייצר בדיוק את סוג הכשל שהוא נועד למנוע.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { codeOf, stripComments, hasCall } from './_code.mjs';

const DIR = 'supabase/tests';
let fails = 0;
const check = (label, ok, detail = '') => {
  if (!ok) fails++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
};

// ═════════ 1. אף בדיקה אינה קוראת מקור ישירות ═════════
console.log('\n★ קריאת מקור עוברת דרך _code.mjs:');
const testFiles = readdirSync(DIR).filter((f) => f.endsWith('.test.mjs'));
const offenders = [];
for (const f of testFiles) {
  const code = codeOf(join(DIR, f));
  if (hasCall(code, 'readFileSync')) offenders.push(f);
}
check(`${testFiles.length} קבצי בדיקה, אף אחד לא קורא readFileSync`,
      offenders.length === 0,
      `עוברים על הכלל: ${offenders.join(', ')} — יש להשתמש ב-codeOf או ב-rawOf`);

// ═════════ 2. המסיר עצמו עובד ═════════
console.log('\n★ המסיר:');
const STRIP_CASES = [
  ['הערת שורה מוסרת',        '// output_config: כאן\nconst a = 1;',  'output_config', false],
  ['הערת בלוק מוסרת',        '/* AbortController */\nconst a = 1;',  'AbortController', false],
  ['מחרוזת עם // שורדת',     'const s = "// לא הערה";',              'לא הערה', true],
  ['template עם // שורד',    'const s = `גדר // כאן`;',              'כאן', true],
  ['URL במחרוזת שורד',       "const s = 'http://x.com';",            'x.com', true],
  ['קוד אחרי הערה שורד',     '// הערה\nconst deliverReply = 1;',      'deliverReply', true],
  ['גרש בתוך מחרוזת',        'const s = "a\\"// b";\nconst c = 2;',   'const c', true],
];
for (const [label, src, needle, shouldSurvive] of STRIP_CASES) {
  const survived = stripComments(src).includes(needle);
  check(`${label}`, survived === shouldSurvive,
        `${JSON.stringify(needle)} ${survived ? 'שרד' : 'הוסר'}, מצופה ${shouldSurvive ? 'לשרוד' : 'להיות מוסר'}`);
}

// ═════════ 3. hasCall מבחין בין קריאה לאזכור ═════════
console.log('\n★ hasCall:');
check('קריאה מזוהה',            hasCall('await deliverReply(db, x);', 'deliverReply'));
check('אזכור בהערה אינו קריאה', !hasCall(stripComments('// deliverReply(db)\nconst a=1;'), 'deliverReply'));
check('שם דומה אינו נחשב',      !hasCall('myDeliverReply(x)', 'deliverReply'));
check('מחרוזת בלבד אינה קריאה', !hasCall("const n = 'deliverReply';", 'deliverReply'));

console.log(fails === 0 ? '\nהיגיינת הבדיקות תקינה' : `\n${fails} בדיקות נכשלו`);
process.exit(fails === 0 ? 0 : 1);
