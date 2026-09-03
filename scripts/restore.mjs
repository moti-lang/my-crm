#!/usr/bin/env node
/**
 * שחזור מקובץ גיבוי של scripts/backup.mjs.   npm run restore -- <קובץ> --yes
 *
 * ⚠️ מוחק את כל הנתונים במסד היעד ומחליף אותם בגיבוי. אין ביטול.
 * בלי --yes רק מציג מה יקרה.
 *
 * הסדר חשוב, בגלל הטריגר על auth.users (f_auth_user_gate):
 *   1. allowed_users בלי user_id ו-invited_by — כדי שהטריגר יכיר את האימיילים.
 *   2. auth.users — הטריגר יוצר profiles לכל אחת, עם אותם מזהים.
 *   3. profiles מהגיבוי — משלימים טלפון וכדומה (upsert).
 *   4. שאר public לפי סדר המפתחות הזרים (מחושב מהקטלוג).
 *   5. הקישורים של allowed_users (user_id, invited_by, branch_id) — בסוף.
 * המיגרציות אינן חלק מהגיבוי: הסכמה חייבת להיות במקום לפני השחזור
 * (db push), והגיבוי חייב להיות מאותה גרסת מיגרציות.
 */
import { readFileSync } from 'node:fs';
import { makeExecutor, loadEnvFile } from './supabase-api.mjs';

loadEnvFile('.env.verify');
loadEnvFile('.env.local');
// PGURL מפורש מנצח: מי שנתן מחרוזת חיבור התכוון אליה, גם אם .env.verify
// מכיל טוקן לענן. (הלקח: שחזור שרץ על הענן במקום על המסד המקומי.)
if (process.env.PGURL) delete process.env.SUPABASE_ACCESS_TOKEN;
else if (process.env.SUPABASE_DB_URL && !process.env.SUPABASE_ACCESS_TOKEN) process.env.PGURL = process.env.SUPABASE_DB_URL;

const args = process.argv.slice(2);
const yes = args.includes('--yes');
const file = args.find((a) => !a.startsWith('--'));
if (!file) { console.error('  ✗ שימוש: node scripts/restore.mjs <קובץ גיבוי> --yes'); process.exit(2); }

const { manifest, data } = JSON.parse(readFileSync(file, 'utf8'));
if (manifest?.format !== 'teichtal-backup/1') { console.error('  ✗ זה לא קובץ גיבוי של המערכת'); process.exit(2); }

const ex = await makeExecutor();
const generatedCache = new Map();
try {
  const [{ v }] = await ex.run(`select string_agg(version, ',' order by version) as v from supabase_migrations.schema_migrations`)
    .catch(() => [{ v: null }]);
  if (manifest.migrations && v && manifest.migrations !== v) {
    throw new Error(`הגיבוי מגרסת מיגרציות ${manifest.migrations} והיעד ב-${v}. להתאים לפני שחזור.`);
  }
  const total = Object.values(manifest.counts).reduce((s, n) => s + n, 0);
  console.log(`  גיבוי מ-${manifest.taken_at} (${manifest.source}), ${total} שורות`);
  console.log(`  יעד: ${ex.label === 'api' ? ex.ref : 'pg'}`);
  if (!yes) { console.log('\n  זו הרצה יבשה. להריץ באמת: --yes (מוחק את כל הנתונים ביעד!)\n'); await ex.close(); process.exit(0); }

  // סדר טבלאות public לפי מפתחות זרים.
  const tables = Object.keys(data).filter((k) => k.startsWith('public.')).map((k) => k.slice(7));
  const deps = await ex.run(`
    select t.relname as child, f.relname as parent
    from pg_constraint k join pg_class t on t.oid = k.conrelid join pg_class f on f.oid = k.confrelid
    join pg_namespace n on n.oid = t.relnamespace
    where k.contype = 'f' and n.nspname = 'public' and t.relname <> f.relname`);
  const order = topo(tables, deps);

  // ─── 1. ניקוי ───
  await ex.run(`truncate ${tables.map((t) => `public.${q(t)}`).join(', ')} cascade; delete from auth.users;`);
  console.log('  · היעד נוקה');

  // ─── 2. allowed_users בלי קישור, ואז auth.users (הטריגר יוצר profiles) ───
  // בלי הקישורים (user_id, invited_by, branch_id): הטבלאות שהם מצביעים אליהן
  // עדיין לא קיימות. הם חוזרים בסוף.
  await insertRows('public.allowed_users', (data['public.allowed_users'] ?? []).map((r) => ({ ...r, user_id: null, invited_by: null, branch_id: null })));
  // חשבונות שהוסרו מהרשימה (פרופיל כבוי) עדיין קיימים ב-auth.users, והשער
  // ידחה אותם. אי אפשר לכבות את הטריגר (הטבלה של supabase_auth_admin), ולכן
  // רושמים אותם זמנית, מכניסים, ומוחקים את הרישום — מה שמכבה את הפרופיל,
  // בדיוק כמו במקור. ה-upsert של profiles אחר כך קובע את המצב הסופי.
  const listed = new Set((data['public.allowed_users'] ?? []).map((r) => r.email));
  const orphans = (data['auth.users'] ?? []).map((u) => (u.email ?? '').toLowerCase()).filter((e) => e && !listed.has(e));
  if (orphans.length) {
    await insertRows('public.allowed_users', orphans.map((email) => ({ email, role: 'accountant', is_active: true, full_name: '__restore_tmp__' })));
  }
  await insertRows('auth.users', data['auth.users'] ?? []);
  if (data['auth.identities']) await insertRows('auth.identities', data['auth.identities']);
  if (orphans.length) await ex.run(`delete from public.allowed_users where full_name = '__restore_tmp__'`);
  // ─── 3. profiles מהגיבוי משלימים את מה שהטריגר יצר ───
  await upsertRows('public.profiles', data['public.profiles'] ?? [], 'id');
  // ─── 4. שאר public לפי הסדר ───
  for (const t of order) {
    if (['allowed_users', 'profiles'].includes(t)) continue;
    await insertRows(`public.${t}`, data[`public.${t}`] ?? []);
  }
  // ─── 5. הקישורים של הרשימה, עכשיו כשהכול קיים. ───
  // הטריגרים של הרשימה כבויים לרגע: branch_staff כבר שוחזר מהגיבוי, ואין
  // צורך שהסנכרון ידרוס אותו; ו-updated_at חוזר לערך המקורי ולא ל-now().
  await ex.run(`alter table public.allowed_users disable trigger allowed_users_before;
                alter table public.allowed_users disable trigger allowed_users_after;`);
  try {
    for (const r of (data['public.allowed_users'] ?? [])) {
      await ex.run(`update public.allowed_users set
          user_id = (select id from public.profiles where email = ${lit(r.email)}),
          invited_by = case when exists (select 1 from public.profiles where id = ${lit(r.invited_by)}::uuid) then ${lit(r.invited_by)}::uuid else null end,
          branch_id = ${lit(r.branch_id)}::uuid,
          updated_at = ${lit(r.updated_at)}::timestamptz
        where id = ${lit(r.id)}`);
    }
  } finally {
    await ex.run(`alter table public.allowed_users enable trigger allowed_users_before;
                  alter table public.allowed_users enable trigger allowed_users_after;`);
  }

  // ─── אימות ───
  let bad = 0;
  for (const [k, n] of Object.entries(manifest.counts)) {
    const [s, t] = k.split('.');
    const [{ c }] = await ex.run(`select count(*)::int as c from ${s}.${q(t)}`);
    if (Number(c) !== n) { bad++; console.log(`  ✗ ${k}: ${c} במקום ${n}`); }
  }
  if (bad) throw new Error(`${bad} טבלאות לא תואמות לגיבוי`);
  console.log(`\n  ✓ שוחזר: ${Object.keys(manifest.counts).length} טבלאות, ${total} שורות, כולן תואמות למניפסט\n`);
} catch (e) {
  console.error(`\n  ✗ השחזור נכשל: ${e.message}\n`);
  await ex.close();
  process.exit(1);
}
await ex.close();

function q(ident) { return `"${ident.replace(/"/g, '""')}"`; }
function lit(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}
/** מעבירים דרך json: כל סוג (uuid, jsonb, מערכים, enum, timestamptz) נפתר לפי עמודת היעד. */
/** עמודות מחושבות (generated) אי אפשר להכניס — auth.users.confirmed_at למשל. */
async function generatedColumns(s, t) {
  const key = `${s}.${t}`;
  if (!generatedCache.has(key)) {
    const rows = await ex.run(`
      select a.attname from pg_attribute a
      join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = ${lit(s)} and c.relname = ${lit(t)} and a.attgenerated <> '' and not a.attisdropped`);
    generatedCache.set(key, new Set(rows.map((r) => r.attname)));
  }
  return generatedCache.get(key);
}
async function insertRows(table, rows, onConflict = 'on conflict do nothing') {
  if (!rows.length) return;
  const [s, t] = table.split('.');
  const skip = await generatedColumns(s, t);
  if (skip.size) rows = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !skip.has(k))));
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const cols = Object.keys(chunk[0]).map(q).join(', ');
    await ex.run(`insert into ${s}.${q(t)} (${cols}) select ${cols} from json_populate_recordset(null::${s}.${q(t)}, ${lit(chunk)}) ${onConflict}`);
  }
  console.log(`  · ${table.padEnd(28)} ${rows.length}`);
}
async function upsertRows(table, rows, key) {
  if (!rows.length) return;
  const [s, t] = table.split('.');
  const skip = await generatedColumns(s, t);
  const cols = Object.keys(rows[0]).filter((c) => c !== key && !skip.has(c));
  const set = cols.map((c) => `${q(c)} = excluded.${q(c)}`).join(', ');
  await insertRows(table, rows, `on conflict (${q(key)}) do update set ${set}`);
}
function topo(tables, deps) {
  const parents = new Map(tables.map((t) => [t, new Set()]));
  for (const d of deps) if (parents.has(d.child) && parents.has(d.parent)) parents.get(d.child).add(d.parent);
  const out = []; const done = new Set();
  const visit = (t, stack = new Set()) => {
    if (done.has(t) || stack.has(t)) return;
    stack.add(t);
    for (const p of parents.get(t) ?? []) visit(p, stack);
    done.add(t); out.push(t);
  };
  for (const t of tables) visit(t);
  return out;
}
