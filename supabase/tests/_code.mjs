/**
 * קריאת קוד לצורך אימות מבני — בלי הערות.
 *
 * הכלל: בדיקה לא מחפשת מחרוזת שיכולה להופיע בהערה.
 *
 * זה קרה שש פעמים, ולשני הכיוונים:
 *   · בדיקה חיובית עוברת כי המילה נמצאת בהערה שמעל הקוד שנמחק.
 *     (AbortController — הקוד הוסר, ההערה נשארה, הבדיקה עברה.)
 *   · בדיקה שלילית נכשלת כי הערה מזכירה את מה שאסור להיות בקוד.
 *     ("אין כאן output_config" בהערה מפילה בדיקה שאוסרת output_config.)
 *
 * שני הכיוונים נסגרים באותה דרך: מסירים את ההערות לפני הבדיקה.
 */
import { readFileSync } from 'node:fs';

/**
 * מסיר הערות מקוד TypeScript/JavaScript, תוך כיבוד מחרוזות.
 *
 * סורק תו-תו ולא ב-regex: `'// לא הערה'` בתוך מחרוזת חייב לשרוד, אחרת
 * המסיר עצמו היה מייצר את סוג הכשל שהוא נועד למנוע.
 * ההערות מוחלפות ברווח כדי שמספרי השורות והגבולות בין אסימונים יישמרו.
 */
export function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i];
    const next = src[i + 1];

    // מחרוזות: ' " `
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += c; i++;
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        out += src[i];
        if (src[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }

    // הערת שורה
    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') { i++; }
      out += ' ';
      continue;
    }

    // הערת בלוק
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        // שמירת שורות חדשות כדי שמספרי השורות לא יזוזו
        if (src[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
      out += ' ';
      continue;
    }

    out += c; i++;
  }
  return out;
}

/** מסיר הערות SQL (`--` עד סוף שורה, ו-/* *​/). */
export function stripSqlComments(src) {
  return stripComments(src.replace(/--[^\n]*/g, ' '));
}

/** קורא קובץ ומחזיר את הקוד בלבד, בלי הערות. */
export function codeOf(path) {
  const raw = readFileSync(path, 'utf8');
  return path.endsWith('.sql') ? stripSqlComments(raw) : stripComments(raw);
}

/** קורא את הקובץ כפי שהוא, כולל הערות. לשימוש כשהטקסט עצמו הוא הנבדק. */
export function rawOf(path) {
  return readFileSync(path, 'utf8');
}

/** האם הקוד מכיל קריאה לפונקציה בשם הזה (ולא רק אזכור שלה). */
export function hasCall(code, name) {
  return new RegExp(String.raw`(?<![A-Za-z0-9_$.])${name}\s*\(`).test(code);
}
