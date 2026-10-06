// מחיקת תלמידה במסך: בעלים בלבד, אישור עם השם, ומסך המחוקות עם שחזור.
import { fileURLToPath } from 'node:url';
import { codeOf } from './_code.mjs';
const src = (f) => codeOf(fileURLToPath(new URL(`../../${f}`, import.meta.url)));
const drawer = src('src/components/StudentDrawer.tsx');
const page = src('src/pages/Students.tsx');
const hooks = src('src/hooks/students.ts');
let failed = 0;
const check = (name, ok) => { console.log(`  ${ok ? '✓' : '✗'} ${name}`); if (!ok) failed++; };

check('★ כפתור המחיקה בכרטיס — רק לבעלים', /\{profile\?\.role === 'owner' && student\.id && \([^]*?deleteStudent\.mutateAsync/.test(drawer));
check('★ אישור לפני מחיקה, עם שם התלמידה', /if \(!window\.confirm\(`למחוק את \$\{student\.full_name\}\?[^]*?\)\) return;\s*void deleteStudent\.mutateAsync/.test(drawer));
check('המחיקה דרך rpc_delete_student (לא update ישיר ולא delete)', /'rpc_delete_student'/.test(hooks) && !/from\('students'\)\.(delete|update)/.test(hooks));
check('★ "כולל מחוקות" — רק לבעלים', /\{isOwner && \([^]*?כולל מחוקות/.test(page) && /\{isOwner && withDeleted && <DeletedStudents/.test(page));
check('שחזור עם אישור', /window\.confirm\(`לשחזר את[^]*?restore\.mutateAsync/.test(page));
check('★ מחיקה סופית רק כשאין חוסמים, ועם אישור', /d\.purge_blockers\.length === 0 && \([^]*?window\.confirm\(`מחיקה סופית[^]*?purge\.mutateAsync/.test(page));

if (failed) { console.log(`  ✗ ${failed} בדיקות מסך המחיקה נכשלו`); process.exit(1); }
console.log('  כל בדיקות מסך המחיקה עברו');
