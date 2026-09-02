/**
 * טוען פונקציה בודדת מקובץ המקור של הייצור.
 *
 * קיים כדי שבדיקה לא תחזיק עותק שני של לוגיקה שרצה בייצור. עותק שני
 * מתיישן בשקט, וכאן זה יקר במיוחד: השוואת מודלים שמודדת הגדרות אחרות
 * מאלה שרצות בפועל מודדת את המערכת הלא נכונה.
 *
 * מסיר את חתימת הטיפוסים של TypeScript ומחזיר פונקציית JavaScript.
 */
import { readFileSync } from 'node:fs';

const DIR = 'supabase/functions/_shared/';

export function loadFromSource(file, name) {
  const src = readFileSync(DIR + file, 'utf8');
  const re = new RegExp(
    String.raw`export function ${name}\(([^)]*)\)(?::[^{]*)?\{[\s\S]*?\n\}`,
  );
  const m = src.match(re);
  if (!m) throw new Error(`לא נמצאה הפונקציה ${name} ב-${DIR}${file}`);
  // הסרת טיפוסי הפרמטרים: (raw: string) → (raw)
  const params = m[1].split(',').map((a) => a.split(':')[0].trim()).filter(Boolean).join(', ');
  const body = m[0].slice(m[0].indexOf('{'));
  return Function(`"use strict"; return (function ${name}(${params}) ${body});`)();
}
