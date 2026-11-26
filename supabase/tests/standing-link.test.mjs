#!/usr/bin/env node
/**
 * ★ "חיבור הוראת קבע מ-SUMIT" — הקוד שמדבר עם SUMIT:
 *   linkableItems: כמה נותרו (מהחיוב הבא עד האחרון), מה אי אפשר לחבר ולמה, ובלי הוראות שכבר מחוברות.
 *   standing-order-link: ההרשאה במסד לפני כל פנייה ל-SUMIT; בחיבור — ההוראה נשלפת שוב מ-SUMIT, והסכום
 *   והתאריכים נלקחים משם (לא מהדפדפן).
 *   node supabase/tests/standing-link.test.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codeOf } from './_code.mjs';

const out = join(mkdtempSync(join(tmpdir(), 'link-')), 'l.mjs');
execFileSync('npx', ['esbuild', 'supabase/functions/_shared/standing-link.ts', '--bundle', '--format=esm', `--outfile=${out}`, '--log-level=error'], { stdio: 'inherit' });
const { linkableItems } = await import(out);

let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`); };

console.log('\nההוראות של הלקוח ב-SUMIT:');
const items = linkableItems([
  { ID: 11, Status: 0, UnitPrice: 210, Date_NextBilling: '2026-12-06T00:00:00', Date_PreviousBilling: '2026-11-06T00:00:00', Date_Last: '2027-06-06T00:00:00+02:00' },
  { ID: 12, Status: 1, UnitPrice: 210, Date_NextBilling: null, Date_PreviousBilling: '2026-10-06', Date_Last: '2027-06-06' },
  { ID: 13, Status: 0, UnitPrice: 0, Date_NextBilling: '2026-12-06', Date_PreviousBilling: null, Date_Last: '2027-01-06' },
  { ID: 14, Status: 0, UnitPrice: 150, Date_NextBilling: '2026-12-06', Date_PreviousBilling: null, Date_Last: null },
  { ID: 15, Status: 3, UnitPrice: 300, Date_NextBilling: '2026-11-20', Date_PreviousBilling: '2026-10-20', Date_Last: '2027-03-20' },
  { ID: 16, Status: 9, UnitPrice: 100, Date_NextBilling: null, Date_PreviousBilling: '2026-09-01', Date_Last: '2026-09-01' },
], [15]);
const by = Object.fromEntries(items.map((i) => [i.id, i]));
check('★ פעילה: 210, נותרו 7 (12/2026 עד 6/2027), תאריכים בלי שעה', by[11]?.linkable && by[11].amount === 210 && by[11].remaining === 7
      && by[11].next === '2026-12-06' && by[11].last === '2027-06-06' && by[11].prev === '2026-11-06' && by[11].statusLabel === 'פעילה', JSON.stringify(by[11]));
check('בוטלה — מוצגת, אי אפשר לחבר, עם הסיבה', by[12] && !by[12].linkable && by[12].reason === 'ההוראה בוטלה ב-SUMIT');
check('בלי סכום — אי אפשר', by[13] && !by[13].linkable && by[13].reason === 'אין סכום להוראה');
check('★ בלי תאריך אחרון — אי אפשר (לא יודעים כמה נותרו)', by[14] && !by[14].linkable && by[14].remaining === null);
check('★ שכבר מחוברת — לא מוצגת', !by[15]);
check('הסתיימה — אי אפשר', by[16] && !by[16].linkable && by[16].reason === 'ההוראה הסתיימה');
check('★ בלי נתוני כרטיס — רק שדות ההוראה', items.every((i) => Object.keys(i).every((k) => ['id', 'status', 'statusLabel', 'amount', 'next', 'prev', 'last', 'remaining', 'linkable', 'reason'].includes(k))));

console.log('\nהפונקציה:');
const fn = codeOf('supabase/functions/standing-order-link/index.ts');
const reqAt = fn.indexOf("rpc('rpc_standing_link_request'"), listAt = fn.indexOf('standingProvider().list('), linkAt = fn.indexOf("rpc('rpc_standing_link_external'");
check('★ ההרשאה במסד (בהרשאות המשתמשת) לפני כל פנייה ל-SUMIT', reqAt > 0 && listAt > reqAt && /userClient\(authorization\)\.rpc\('rpc_standing_link_request'/.test(fn));
check('★ אם ההרשאה נכשלה — עוצרים (403)', /if \(error\) return json\(\{ ok: false, error: error\.message \}, 403\);/.test(fn.slice(reqAt, listAt)));
check('★ בחיבור: ההוראה מהרשימה של SUMIT (לא מהדפדפן), ורק אם אפשר לחבר', linkAt > listAt && /const item = items\.find\(\(i\) => i\.id === recurring\);/.test(fn) && /if \(!item\.linkable\)/.test(fn));
check('★ הסכום והתאריכים — מ-SUMIT', /p_amount: item\.amount/.test(fn) && /p_next: item\.next, p_prev: item\.prev, p_final: item\.last/.test(fn) && !/body\.amount/.test(fn));

console.log(fails === 0 ? '\nחיבור הוראת קבע מ-SUMIT: הכל עבר' : `\n${fails} בדיקות נכשלו`);
process.exit(fails === 0 ? 0 : 1);
