// wa-provision / wa-admin — הסדר בקוד הוא האבטחה:
//   wa-admin: בדיקת בעלים במסד לפני כל פנייה לשרת. wa-provision: מוודאים שהשרת
//   עונה בכתובת עם המפתח לפני ששומרים. הדפדפן לא מקבל אף פעם את מפתח ה-API.
import { fileURLToPath } from 'node:url';
import { codeOf } from './_code.mjs';
const src = (f) => codeOf(fileURLToPath(new URL(`../functions/${f}`, import.meta.url)));
const admin = src('wa-admin/index.ts'), prov = src('wa-provision/index.ts');
let failed = 0;
const check = (name, ok) => { console.log(`  ${ok ? '✓' : '✗'} ${name}`); if (!ok) failed++; };
const ownerAt = admin.indexOf("if (role !== 'owner') return json(");
check('★ wa-admin: בדיקת בעלים (auth_role במסד) לפני כל פנייה לשרת', /rpc\('auth_role'\)/.test(admin) && ownerAt > 0 && ownerAt < admin.indexOf('await fetch('));
check('★ wa-admin: מפתח ה-API לא חוזר לדפדפן', !/apiKey:\s*cfg|api_key|webhookSecret/.test(admin.slice(admin.indexOf('return json({\n      ok: true'))));
check('wa-admin: רק status / connect / disconnect', /\['status', 'connect', 'disconnect'\]\.includes\(action\)/.test(admin));
const verifyAt = prov.indexOf('/api/status`'), saveAt = prov.indexOf("rpc('rpc_wa_provision'");
check('★ wa-provision: השרת מאומת (עונה עם המפתח) לפני השמירה', verifyAt > 0 && saveAt > verifyAt && /if \(!res\.ok\) return json/.test(prov));
check('wa-provision: רק https', /\^https:\\\/\\\/\[a-z0-9\.-\]\+\$/.test(prov));
if (failed) { console.log(`  ✗ ${failed} בדיקות wa-provision נכשלו`); process.exit(1); }
console.log('  כל בדיקות wa-provision / wa-admin עברו');
