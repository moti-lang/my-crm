#!/usr/bin/env node
/**
 * מנוע התבניות קיים בשני עותקים: src/lib/template.ts לפרונט,
 * supabase/functions/_shared/template.ts ל-Edge Functions
 * (Supabase אורזת כל פונקציה מתיקייתה ואי אפשר לייבא מ-src/).
 *
 * הכפילות מכוונת. הבדיקה הזו מוודאת שהיא לא נעשית סתירה: שני
 * המימושים רצים על אותם קלטים וחייבים להחזיר בדיוק אותו פלט.
 * תצוגה מקדימה שמראה טקסט אחד וההורה מקבל אחר היא באג שקט.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'tpl-'));
const build = (src, out) =>
  execFileSync('npx', ['esbuild', src, '--bundle', '--format=esm', `--outfile=${join(dir, out)}`,
    '--log-level=error'], { stdio: 'inherit' });

build('src/lib/template.ts', 'front.mjs');
build('supabase/functions/_shared/template.ts', 'edge.mjs');

const front = await import(join(dir, 'front.mjs'));
const edge = await import(join(dir, 'edge.mjs'));

const CASES = [
  ['היי {parent_name}, נותרה יתרה של {balance} עבור {student_name} בסניף {branch}.',
   { parent_name: 'רחלי כהן', balance: '₪1,300', student_name: 'שירה', branch: 'ביתר עילית' }],
  ['היי {parent_name}, יתרה של {balance} עבור {student_name}.', { parent_name: 'רחלי' }],  // חסרים
  ['{a} {b} {c}', {}],                                                                     // הכל חסר
  ['שלום  {student_name}   ,  מה שלומך ?', { student_name: 'שירה' }],                      // רווחים כפולים
  ['שורה\n\n\n\nשורה', {}],                                                                 // שורות ריקות
  ['בלי משתנים בכלל 🌸', {}],
  ['{student_name}{student_name}{student_name}', { student_name: 'א' }],
  ['הקישור: {link}', { link: 'https://example.com/a/abc123' }],
  ['', {}],
  ['{unknown_variable} נשאר?', {}],
];

let fails = 0;
for (const [body, vars] of CASES) {
  const a = front.renderTemplate(body, vars);
  const b = edge.renderTemplate(body, vars);
  const ok = a === b;
  if (!ok) fails++;
  console.log(`  ${ok ? '✓' : '✗'} ${JSON.stringify(body).slice(0, 48)}`);
  if (!ok) console.log(`      front: ${JSON.stringify(a)}\n      edge:  ${JSON.stringify(b)}`);
}

const varsMatch = JSON.stringify(front.TEMPLATE_VARIABLES) === JSON.stringify(edge.TEMPLATE_VARIABLES);
if (!varsMatch) fails++;
console.log(`  ${varsMatch ? '✓' : '✗'} רשימת המשתנים זהה בשני העותקים`);

console.log(fails === 0 ? '\nשני מנועי התבניות זהים' : `\n${fails} הבדלים בין העותקים`);
process.exit(fails ? 1 : 0);
