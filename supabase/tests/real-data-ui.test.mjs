#!/usr/bin/env node
/**
 * ממצאי הנתונים האמיתיים בצד הלקוח ובפונקציות:
 *   2. חייבת בלי טלפון: תג במסך הגבייה + התראה יומית מ-cron-debt.
 *   5. סגירת סניף: כפתור לבעלים בלבד, דרך rpc_close_branch, עם אישור.
 *   6. תשלום יתר: אזהרה (לא חסימה) בטופס התשלום.
 *   npm run test:real-data-ui
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codeOf } from './_code.mjs';

let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`); };
const dir = mkdtempSync(join(tmpdir(), 'rd-'));
const out = join(dir, 'payments.cjs');
execFileSync('npx', ['esbuild', 'src/lib/payments.ts', '--bundle', '--format=cjs', '--platform=node', `--outfile=${out}`, '--log-level=error', '--alias:@=./src']);
const { overpaymentWarning } = await import(out);

console.log('\n6. תשלום יתר:');
check('תשלום בגובה החוב — בלי אזהרה', overpaymentWarning(1000, 1000) === null);
check('תשלום חלקי — בלי אזהרה', overpaymentWarning(300, 1000) === null);
check('★ תשלום גדול מהחוב — אזהרה עם העודף', /גדול מהחוב ב-.*500/.test(overpaymentWarning(1500, 1000) ?? ''), overpaymentWarning(1500, 1000));
check('★ תשלום ביתרה אפס — אזהרה עם יתרת הזכות', /אין חוב פתוח.*100/.test(overpaymentWarning(100, 0) ?? ''), overpaymentWarning(100, 0));
check('תשלום ביתרת זכות קיימת — הזכות המצטברת', /600/.test(overpaymentWarning(100, -500) ?? ''), overpaymentWarning(100, -500));
check('סכום ריק — בלי אזהרה', overpaymentWarning(NaN, 1000) === null && overpaymentWarning(0, 0) === null);
const form = codeOf('src/components/PaymentForm.tsx');
check('★ הטופס מציג את האזהרה ולא חוסם', /overpaymentWarning\(amount, balance\)/.test(form) && /\{warning && \(/.test(form) && !/max=\{balance\}/.test(form));

console.log('\n2. חייבת בלי טלפון:');
const coll = codeOf('src/pages/Collection.tsx');
check('★ תג "אין טלפון" במסך הגבייה', /אין טלפון/.test(coll) && /d\.parent_phone\s*\?/.test(coll));
const debt = codeOf('supabase/functions/cron-debt/index.ts');
check('★ cron-debt אוספת את החייבות בלי טלפון', /noPhone\.push\(/.test(debt));
check('★ ומתריעה לבעלים (system_alerts, kind=debtors_no_phone)', /kind: 'debtors_no_phone'/.test(debt));
check('פעם ביום, לא בכל ריצה (בדיקת 24 שעות)', /24 \* 3600 \* 1000/.test(debt) && /\.eq\('kind', 'debtors_no_phone'\)\.gte\('created_at', since\)/.test(debt));
check('ההתראה אומרת מה לעשות', /להשלים טלפון/.test(debt));

console.log('\n5. סגירת סניף:');
const detail = codeOf('src/pages/BranchDetail.tsx');
const hooks = codeOf('src/hooks/queries.ts');
check("★ הכפתור לבעלים בלבד ורק לסניף פעיל", /profile\?\.role === 'owner' && b\.is_active/.test(detail));
check('★ עם אישור לפני', /window\.confirm\(/.test(detail));
check('★ דרך rpc_close_branch (הכלל במסד, לא בלקוח)', /rpc\('rpc_close_branch'/.test(hooks) && !/from\('branches'\)\.update/.test(detail));
check('שגיאה בעברית מהמסד מוצגת כמו שהיא', /\[\\u0590-\\u05FF\]/.test(codeOf('src/lib/errors.ts')));

console.log(fails === 0 ? '\nממצאי הנתונים האמיתיים: הכל במקום' : `\n${fails} בדיקות נכשלו`);
process.exit(fails ? 1 : 0);
