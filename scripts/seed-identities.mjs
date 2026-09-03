#!/usr/bin/env node
/**
 * זהויות הבדיקה בענן — אותו קובץ בדיוק שרץ מקומית:
 * supabase/tests/01_local_users.sql, דרך ה-Management API (או PGURL).
 *
 * למה SQL ולא ה-Admin API: ה-Admin API מוסיף את השורה ל-auth.users עם
 * ספק email ורק אחר כך מעדכן את app_metadata. הטריגר f_auth_user_gate
 * רואה את ההוספה, ודוחה אותה — כפי שהוא אמור לדחות כל חשבון שאינו
 * מגוגל. (verify-access.mjs מוכיח את הדחייה הזו בכל סבב.)
 *
 * הוספה ישירה ל-auth.users עם ספק google עוברת באותו טריגר שעוברת כניסה
 * אמיתית בגוגל: שורה ברשימה, ואז השורה ב-auth.users — והפרופיל, התפקיד
 * והשיוך לסניף נוצרים בטריגר. אם הוא נשבר, אף זהות לא נוצרת.
 *
 * לזהויות האלה אין auth.identities, אין סיסמה ואין חשבון גוגל — אין דרך
 * להיכנס איתן. הן קיימות רק כדי שחבילות ה-SQL ירוצו מול הענן בשלושת
 * התפקידים (שלב 4). הבעלים האמיתית אינה כאן: supabase/seed_allowlist.sql.
 *
 *   node scripts/seed-identities.mjs           # יצירה (אידמפוטנטי)
 *   node scripts/seed-identities.mjs --purge   # מחיקה לפני מסירה ללקוחה
 */
import { readFileSync } from 'node:fs';
import { makeExecutor } from './supabase-api.mjs';

const purge = process.argv.includes('--purge');
const ex = await makeExecutor();
try {
  if (purge) await purgeAll(); else await seed();
} catch (e) {
  console.error(`\n  ✗ ${e.message}\n`);
  await ex.close();
  process.exit(1);
}
await ex.close();

async function seed() {
  const [{ c }] = await ex.run('select count(*)::int as c from public.branches');
  if (Number(c) === 0) throw new Error('אין סניפים — seed.sql לא רץ');

  await ex.run(readFileSync('supabase/tests/01_local_users.sql', 'utf8'));

  const rows = await ex.run(`
    select a.email, a.role::text as role, p.id::text as id, p.is_active,
           (select count(*) from public.branch_staff s where s.user_id = p.id)::int as branches
    from public.allowed_users a
    left join public.profiles p on p.id = a.user_id
    where a.email like '%@teichtal.local'
    order by a.email`);
  if (rows.length !== 3) throw new Error(`ציפינו ל-3 זהויות, נמצאו ${rows.length}`);
  for (const r of rows) {
    if (!r.id || !r.is_active) throw new Error(`${r.email}: ברשימה אבל הטריגר לא יצר פרופיל פעיל`);
    if (r.role === 'branch_manager' && Number(r.branches) !== 1) throw new Error(`${r.email}: מנהלת סניף בלי שיוך`);
    console.log(`  = ${r.email.padEnd(24)} ${r.role.padEnd(15)} ${r.id}`);
  }
  console.log('\nזהויות הבדיקה מוכנות. אין להן סיסמה ואין להן חשבון גוגל — אי אפשר להיכנס איתן.\n');
}

async function purgeAll() {
  // מה שמצביע עליהן מתאפס; הרשומות עצמן נשארות. אותו ניקוי כמו במיגרציה 0014.
  await ex.run(`
    do $$
    declare v_ids uuid[]; c record;
    begin
      select array_agg(id) into v_ids from public.profiles where email like '%@teichtal.local';
      if v_ids is null then return; end if;
      for c in
        select t.relname as tbl, a.attname as col
        from pg_constraint k
        join pg_class t on t.oid = k.conrelid
        join pg_class f on f.oid = k.confrelid and f.relname = 'profiles'
        join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey)
        where k.contype = 'f' and k.confdeltype <> 'c'
      loop
        execute format('update public.%I set %I = null where %I = any($1)', c.tbl, c.col, c.col) using v_ids;
      end loop;
      delete from auth.users where id = any(v_ids);
    end $$;
    delete from public.allowed_users where email like '%@teichtal.local';`);
  const left = await ex.run(`
    select (select count(*) from public.allowed_users where email like '%@teichtal.local')::int as a,
           (select count(*) from public.profiles where email like '%@teichtal.local')::int as p`);
  if (Number(left[0].a) || Number(left[0].p)) throw new Error('נשארו זהויות בדיקה אחרי המחיקה');
  const owners = await ex.run(`select email from public.allowed_users where role = 'owner' and is_active`);
  console.log(`  − שלוש זהויות הבדיקה נמחקו. ברשימה: ${owners.map((o) => o.email).join(', ') || 'אף אחת!'}\n`);
  if (owners.length === 0) throw new Error('אין בעלים פעילה ברשימה — אין מי שיכנס');
}
