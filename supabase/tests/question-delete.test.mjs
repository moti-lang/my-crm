// מחיקת שאלות: כפתור בכל מקום שמנהלים שאלות, ותמיד עם אישור לפני.
import { fileURLToPath } from 'node:url';
import { codeOf } from './_code.mjs';
const page = codeOf(fileURLToPath(new URL('../../src/pages/Agent.tsx', import.meta.url)));
const hooks = codeOf(fileURLToPath(new URL('../../src/hooks/agent.ts', import.meta.url)));
let failed = 0;
const check = (name, ok) => { console.log(`  ${ok ? '✓' : '✗'} ${name}`); if (!ok) failed++; };
const block = (start, end) => page.slice(page.indexOf(start), page.indexOf(end, page.indexOf(start)));
const faqTab = block('function FaqTab(', '\nfunction ');
const unTab = block('function UnansweredTab(', '\n}\n');

check('hook: מחיקה מ-faq_entries', /from\('faq_entries'\)\.delete\(\)/.test(hooks));
check('hook: מחיקה מ-unanswered_questions', /from\('unanswered_questions'\)\.delete\(\)/.test(hooks));
// המאגר מציג גם את השאלות הכלליות וגם את שכבות הסניף באותה רשימה — כפתור אחד לכל שורה.
check('★ מאגר השאלות (כללי + שכבת סניף): כפתור מחיקה עם אישור לפני', /window\.confirm\(`למחוק את השאלה[^]*?\)\) return;[^]*?remove\.mutateAsync\(f\.id\)/.test(faqTab));
check('★ שאלות ללא מענה: כפתור מחיקה עם אישור לפני', /if \(window\.confirm\(`למחוק את השאלה[^]*?\)\) void remove\.mutateAsync\(q\.id\)/.test(unTab));
check('אין מחיקה בלי אישור', (page.match(/remove\.mutateAsync\(/g) ?? []).length === (page.match(/window\.confirm\(`למחוק/g) ?? []).length);

if (failed) { console.log(`  ✗ ${failed} בדיקות מחיקת שאלות נכשלו`); process.exit(1); }
console.log('  כל בדיקות כפתורי המחיקה עברו');
