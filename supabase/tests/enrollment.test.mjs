#!/usr/bin/env node
/**
 * הרשמה — צד הלקוח והסיכום היומי:
 *   · האימות בדף זהה לכללי המסד (שם אותיות בלבד, נייד ישראלי, מייל, תקנון חובה).
 *   · תיאור מבנה התשלום להורה נגזר מהמספרים בהגדרות, לא מקוד.
 *   · הסיכום היומי מכיל את שתי שורות ההרשמה, והתבנית מכירה את המשתנים.
 *   npm run test:enrollment
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codeOf } from './_code.mjs';

let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`); };
const dir = mkdtempSync(join(tmpdir(), 'enroll-'));
const out = join(dir, 'e.cjs');
execFileSync('npx', ['esbuild', 'src/lib/enrollment.ts', '--bundle', '--format=cjs', '--platform=node', `--outfile=${out}`, '--log-level=error']);
const e = await import(out);
const good = { first_name: 'רבקה', last_name: 'כהן', grade: 'ד', school: 'בית יעקב', phone: '052-111-2233', email: 'a@b.co.il', branch_id: 'x', mailing_consent: true, terms_accepted: true };

console.log('\nאימות בדף:');
check('טופס תקין — בלי שגיאות', Object.keys(e.validateEnroll(good)).length === 0, JSON.stringify(e.validateEnroll(good)));
check('★ בלי אישור תקנון — נחסם', e.validateEnroll({ ...good, terms_accepted: false }).terms_accepted !== undefined);
check('★ שם עם תווים זרים — נחסם', e.validateEnroll({ ...good, first_name: '<b>x</b>' }).first_name !== undefined && e.validateEnroll({ ...good, first_name: 'רבקה1' }).first_name !== undefined);
check("שם עם גרש ומקף — תקין", Object.keys(e.validateEnroll({ ...good, last_name: "כ״ץ-או'ברייאן" })).length === 0);
check('טלפון קווי/קצר — נחסם; נייד מנורמל', e.validateEnroll({ ...good, phone: '03-1234567' }).phone !== undefined && e.normalizePhone('052-111-2233') === '972521112233');
check('מייל לא תקין — נחסם', e.validateEnroll({ ...good, email: 'x@' }).email !== undefined);
check('בלי סניף — נחסם', e.validateEnroll({ ...good, branch_id: '' }).branch_id !== undefined);
check('כל השגיאות בעברית', Object.values(e.validateEnroll({ ...good, first_name: '', phone: 'x', email: 'y', branch_id: '', terms_accepted: false })).every((m) => /[֐-׿]/.test(m)));

console.log('\nמבנה התשלום להורה:');
const d = e.describePlan({ annual_total: 1200, registration_fee: 100, installments: 10, installment_amount: 110, first_charge: 210 });
check('★ "1200", "210", "100 ₪ דמי רישום", "9 תשלומים", "110"', /1200/.test(d) && /210/.test(d) && /100 ₪ דמי רישום/.test(d) && /9 תשלומים/.test(d));
const d2 = e.describePlan({ annual_total: 1500, registration_fee: 150, installments: 9, installment_amount: 150, first_charge: 300 });
check('שנה הבאה עם מספרים אחרים — אותו קוד', /1500/.test(d2) && /8 תשלומים/.test(d2) && /300/.test(d2));

console.log('\nהסיכום היומי:');
const summary = codeOf('supabase/functions/cron-summary/index.ts');
check('★ cron-summary שואל rpc_enrollment_digest ומכניס שתי שורות', /rpc_enrollment_digest/.test(summary) && /enrollment: enrollmentLine/.test(summary) && /enrollment_overdue: overdueLine/.test(summary));
check('★ מעל 3 ימים — בשמות ובימים', /\$\{o\.name\} \(\$\{o\.days\} ימים\)/.test(summary));
const seed = codeOf('supabase/seed.sql');
check('★ תבנית owner_daily מכילה {enrollment} ו-{enrollment_overdue}', /\{enrollment\}/.test(seed) && /\{enrollment_overdue\}/.test(seed));
const tv = codeOf('src/lib/template.ts');
check('המשתנים ברשימת התבניות (העורך מציג אותם)', /'enrollment', 'enrollment_overdue'/.test(tv));

console.log('\nהגדרות, לא קוד:');
const enrollSrc = codeOf('src/pages/Enroll.tsx') + codeOf('src/hooks/enrollment.ts') + codeOf('src/lib/enrollment.ts');
check('★ אין "1200", "210", "110" או "100" כסכומים בקוד הלקוח של ההרשמה', !/\b(1200|210|110)\b/.test(enrollSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
const mig = codeOf('supabase/migrations/0023_enrollment.sql');
check('★ rpc_enroll לוקח את הסכומים מ-f_enrollment_plan (ההגדרות), לא ממספרים', /v_plan := f_enrollment_plan\(\)/.test(mig) && /\(v_plan ->> 'first_charge'\)::numeric/.test(mig));
check('★ f_enrollment_plan מסרבת כשהמבנה לא מסתכם', /if v_fee \+ v_n \* v_each <> v_total then/.test(mig));

console.log(fails === 0 ? '\nהרשמה: הכל במקום' : `\n${fails} בדיקות נכשלו`);
process.exit(fails ? 1 : 0);
