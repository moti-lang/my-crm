#!/usr/bin/env node
/**
 * אימות שחזור, שורה-שורה.   node scripts/restore-verify.mjs <קובץ גיבוי>
 *
 * ספירת שורות (מה ש-restore.mjs בודק) לא מספיקה: 21 תלמידות עם שמות שגויים
 * הן עדיין 21. כאן כל שורה בכל טבלה בגיבוי נמשכת מהיעד באותו row_to_json,
 * ומושווית תו-בתו (בלי עמודות מחושבות, שאין להן מקור בגיבוי).
 * בנוסף: הזהויות, ההרשאות, הטוקנים וההגדרות — במפורש, כי אלה מה ששואלים
 * עליהם ביום שאחרי.
 */
import { readFileSync } from 'node:fs';
import { makeExecutor, loadEnvFile } from './supabase-api.mjs';

loadEnvFile('.env.verify'); loadEnvFile('.env.local');
if (process.env.PGURL) delete process.env.SUPABASE_ACCESS_TOKEN;
const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!file) { console.error('  ✗ שימוש: node scripts/restore-verify.mjs <קובץ גיבוי>'); process.exit(2); }
const { manifest, data } = JSON.parse(readFileSync(file, 'utf8'));
const ex = await makeExecutor();
let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`); };
const canon = (o) => JSON.stringify(Object.keys(o).sort().reduce((a, k) => (a[k] = o[k], a), {}));
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

try {
  // ─── 1. כל שורה, בכל טבלה ───
  let rowsChecked = 0, tablesBad = 0;
  for (const key of Object.keys(data)) {
    const [s, t] = key.split('.');
    const gen = (await ex.run(`select a.attname from pg_attribute a join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace where n.nspname = ${lit(s)} and c.relname = ${lit(t)} and a.attgenerated <> ''`)).map((r) => r.attname);
    const strip = (r) => { const c = { ...r }; for (const g of gen) delete c[g]; return c; };
    const want = new Map(data[key].map((r) => { const c = canon(strip(r)); return [c, c]; }));
    const got = (await ex.run(`select row_to_json(x)::text as r from ${s}."${t}" x`)).map((r) => canon(strip(JSON.parse(r.r))));
    const missing = [...want.keys()].filter((c) => !got.includes(c));
    const extra = got.filter((c) => !want.has(c));
    rowsChecked += data[key].length;
    if (missing.length || extra.length) {
      tablesBad++;
      check(`${key}: ${data[key].length} שורות זהות`, false, `${missing.length} חסרות/שונות, ${extra.length} עודפות. דוגמה: ${(missing[0] ?? extra[0] ?? '').slice(0, 200)}`);
    }
  }
  check(`★ ${Object.keys(data).length} טבלאות, ${rowsChecked} שורות — כל שורה זהה לגיבוי`, tablesBad === 0);

  // ─── 2. מה ששואלים עליו ביום שאחרי ───
  const users = data['auth.users'] ?? [];
  const [{ n: dbUsers }] = await ex.run(`select count(*)::int as n from auth.users`);
  check(`משתמשות: ${users.length} חשבונות auth`, Number(dbUsers) === users.length);
  const [{ n: identities }] = await ex.run(`select count(*)::int as n from auth.identities where provider = 'google'`);
  check(`זהויות גוגל: ${identities} (כמו בגיבוי)`, Number(identities) === (data['auth.identities'] ?? []).filter((i) => i.provider === 'google').length);
  const [{ n: linked }] = await ex.run(`select count(*)::int as n from public.allowed_users a join public.profiles p on p.id = a.user_id where a.joined_at is not null`);
  check(`רשימת המורשים מקושרת לפרופילים: ${linked} שהצטרפו`, Number(linked) === (data['public.allowed_users'] ?? []).filter((a) => a.joined_at).length);
  const roles = await ex.run(`select a.email, a.role as listed, p.role as profile, p.is_active from public.allowed_users a join public.profiles p on p.id = a.user_id`);
  check('★ התפקיד בפרופיל זהה לרשימה, לכל מי שהצטרפה', roles.every((r) => r.listed === r.profile), JSON.stringify(roles.find((r) => r.listed !== r.profile)));
  const [{ n: owners }] = await ex.run(`select count(*)::int as n from public.profiles where role = 'owner' and is_active`);
  check(`בעלים פעילות: ${owners}`, Number(owners) >= 1);
  const [{ n: staff }] = await ex.run(`select count(*)::int as n from public.branch_staff`);
  check(`שיוכי סניף: ${staff}`, Number(staff) === (data['public.branch_staff'] ?? []).length);
  const [{ n: tokens }] = await ex.run(`select count(*)::int as n from public.attendance_links where is_active`);
  check(`טוקני נוכחות פעילים: ${tokens} — אותם טוקנים, קישורים שנשלחו בוואטסאפ ממשיכים לעבוד`,
        Number(tokens) === (data['public.attendance_links'] ?? []).filter((l) => l.is_active).length);
  const [{ ok }] = await ex.run(`select (rpc_attendance_sheet((select token from public.attendance_links where is_active limit 1)) ->> 'ok')::boolean as ok`);
  check('★ טוקן משוחזר פותח גיליון נוכחות', ok === true);
  const settings = await ex.run(`select key, value::text as v from public.settings order by key`);
  const wantSettings = new Map((data['public.settings'] ?? []).map((s) => [s.key, JSON.stringify(s.value)]));
  check(`הגדרות: ${settings.length} מפתחות זהים`, settings.length === wantSettings.size && settings.every((s) => JSON.stringify(JSON.parse(s.v)) === wantSettings.get(s.key)));
  const [{ v }] = await ex.run(`select string_agg(version, ',' order by version) as v from supabase_migrations.schema_migrations`).catch(() => [{ v: null }]);
  check(`סכמה: מיגרציות ${manifest.migrations?.split(',').pop()} כמו בגיבוי`, !v || v === manifest.migrations);
} catch (e) {
  fails++; console.error(`  ✗ ${e.message}`);
}
await ex.close();
console.log(fails === 0 ? '\n  ✓ השחזור מלא: כל שורה, כל משתמשת, כל הרשאה, כל טוקן, כל הגדרה\n' : `\n  ✗ ${fails} בדיקות נכשלו — השחזור אינו מלא\n`);
process.exit(fails ? 1 : 0);
