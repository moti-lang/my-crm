// טופס ההרשמה ודף התשלום: בלי המילה "חוג" כברירת מחדל — רק שם החוג של הסניף, אם הוגדר.
// codeOf מסיר הערות, כך שנבדק רק מה שמגיע למסך.
import { fileURLToPath } from 'node:url';
import { codeOf } from './_code.mjs';
const files = ['src/pages/Enroll.tsx', 'src/lib/enrollment.ts', 'src/hooks/enrollment.ts', 'src/pages/Pay.tsx',
               'supabase/functions/enroll/index.ts', 'supabase/functions/sumit-checkout/index.ts'];
let failed = 0;
for (const f of files) {
  const hits = codeOf(fileURLToPath(new URL(`../../${f}`, import.meta.url))).split('\n').filter((l) => /חוג/.test(l));
  const ok = hits.length === 0;
  console.log(`  ${ok ? '✓' : '✗'} ${f}: אין "חוג"${ok ? '' : ` — ${hits.map((h) => h.trim()).join(' | ')}`}`);
  if (!ok) failed++;
}
if (failed) { console.log(`  ✗ ${failed} קבצים עם "חוג" — נכשלו`); process.exit(1); }
console.log('  כל בדיקות המילה "חוג" עברו');
