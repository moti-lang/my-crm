/**
 * שכבת הסניף מעל המידע הכללי של הסוכן (_shared/knowledge-layer.ts).
 * הסניף ידוע → התוספת של הסניף גוברת; לא ידוע → כל סניף מסומן בשמו;
 * ושני המסלולים (וואטסאפ והסימולטור) משתמשים באותה פונקציה.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codeOf } from './_code.mjs';

const out = join(mkdtempSync(join(tmpdir(), 'kl-')), 'kl.mjs');
execFileSync('npx', ['esbuild', 'supabase/functions/_shared/knowledge-layer.ts', '--bundle', '--format=esm', `--outfile=${out}`, '--log-level=error']);
const { layerForBranch } = await import(out);

let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`); };

const BS = { id: 'b-bs', name: 'בית שמש' }, BT = { id: 'b-bt', name: 'ביתר' };
const faq = [
  { id: 'g1', question: 'באילו ימים?', answer: 'כל סניף בימים משלו', branch_id: null },
  { id: 'g2', question: 'מה להביא?', answer: 'בגדים נוחים', branch_id: null },
  { id: 's1', question: 'באילו ימים?', answer: 'בבית שמש: ראשון ורביעי', branch_id: BS.id },
  { id: 's2', question: 'איפה חונים?', answer: 'חניה ברחוב', branch_id: BS.id },
  { id: 't1', question: 'באילו ימים?', answer: 'בביתר: שני', branch_id: BT.id },
];
const kn = [
  { title: 'הצוות', body: 'הניה וצוות המורות', branch_id: null },
  { title: 'הצוות', body: 'בבית שמש מלמדת רחל', branch_id: BS.id },
];

{
  const r = layerForBranch(faq, kn, [BS, BT], BS.id);
  const days = r.faq.filter((f) => f.question === 'באילו ימים?');
  check('★ סניף ידוע: התוספת של הסניף גוברת על הכללי', days.length === 1 && days[0].answer === 'בבית שמש: ראשון ורביעי', JSON.stringify(days));
  check('★ סניף ידוע: אין תשובות של סניף אחר', !r.faq.some((f) => f.answer.includes('ביתר')));
  check('כללי שאין לו תוספת — נשאר', r.faq.some((f) => f.question === 'מה להביא?'));
  check('שאלה שקיימת רק בסניף — נוספת', r.faq.some((f) => f.question === 'איפה חונים?'));
  check('★ גם במידע על החוג: קטע הסניף גובר', r.knowledge.length === 1 && r.knowledge[0].body.includes('רחל'));
  check('מזהה השאלה נשמר (מונה שימוש)', r.faq.find((f) => f.question === 'באילו ימים?')?.id === 's1');
}
{
  const r = layerForBranch(faq, kn, [BS, BT], null);
  check('★ סניף לא ידוע: הכללי נשאר כמו שהוא', r.faq.some((f) => f.question === 'באילו ימים?' && f.answer === 'כל סניף בימים משלו'));
  check('★ סניף לא ידוע: כל תוספת מסומנת בשם הסניף', r.faq.some((f) => f.question === 'באילו ימים? (סניף בית שמש)') && r.faq.some((f) => f.question === 'באילו ימים? (סניף ביתר)'));
  check('שאלות ייחודיות (ה-resolver דורש התאמה מדויקת)', new Set(r.faq.map((f) => f.question)).size === r.faq.length);
  check('קטעי מידע של סניף — מסומנים', r.knowledge.some((k) => k.title === 'הצוות — סניף בית שמש'));
}
{
  const r = layerForBranch(faq, kn, [BS], null);
  check('★ סניף פעיל יחיד: נחשב ידוע', r.branchId === BS.id && r.faq.find((f) => f.question === 'באילו ימים?')?.answer.includes('בית שמש'));
  check('סניף שלא ברשימה (סגור) — לא נכנס', !r.faq.some((f) => f.answer.includes('ביתר')));
}
{
  const customer = codeOf('supabase/functions/_shared/customer.ts');
  const sim = codeOf('supabase/functions/ai-answer/index.ts');
  check('★ וואטסאפ משתמש בשכבה, לפי הסניף של התלמידה או הליד', /layerForBranch\(/.test(customer) && /conversation\.student_id/.test(customer) && /knownBranchId/.test(customer));
  check('★ הסימולטור משתמש באותה פונקציה', /layerForBranch\(/.test(sim));
}

console.log(fails === 0 ? '\nשכבת הסניף: הכל במקום' : `\n${fails} בדיקות נכשלו`);
process.exit(fails ? 1 : 0);
