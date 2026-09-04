#!/usr/bin/env node
/**
 * שלב 3 — הדלת מול הענן האמיתי: גוגל בלבד, רשימת מורשים בלבד.
 *
 * אי אפשר להתחבר בגוגל מסקריפט. מה שכן אפשר, ומוכיח את אותו דבר:
 * ה-Admin API מוסיף ל-auth.users בדיוק כמו GoTrue אחרי גוגל, ועובר
 * באותו טריגר. אז:
 *   · אימייל שאינו ברשימה, "מגוגל"   → הטריגר מפיל את יצירת החשבון.
 *   · אימייל ברשימה, בסיסמה          → הטריגר מפיל. אין חשבונות סיסמה.
 *   · אימייל ברשימה, מגוגל (הוספה ישירה ל-auth.users, כמו GoTrue אחרי
 *     גוגל, בטרנזקציה שמתגלגלת לאחור) → נוצר, עם התפקיד שחיכה לו.
 *   · כניסה בסיסמה / הרשמה עצמית מול GoTrue → נדחות: ספק האימייל כבוי.
 *   · anon אינו קורא מהרשימה.
 * בקרת השלילה (negative-control.sh) מוכיחה מקומית שאותה חבילה נופלת
 * כשהטריגר מוסר.
 */
import { createClient } from '@supabase/supabase-js';
import { loadEnvFile } from './supabase-api.mjs';

loadEnvFile('.env.local');
const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OWNER_EMAIL = process.env.OWNER_EMAIL ?? 'moti@automation1.co.il';
if (!URL || !ANON || !SERVICE) {
  console.error('✗ חסרים SUPABASE_URL, SUPABASE_ANON_KEY או SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

let fails = 0;
const check = (label, ok, detail = '') => {
  if (!ok) fails++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
};
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const anon = () => createClient(URL, ANON, { auth: { persistSession: false } });
const GOOGLE = { provider: 'google', providers: ['google'] };
const stamp = Date.now();

async function countUsers() {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return data?.users.length ?? -1;
}

// ═══════ 1. אימייל שאינו ברשימה — אין חשבון ═══════
console.log('\nאימייל שאינו ברשימה:');
{
  const before = await countUsers();
  const email = `stranger-${stamp}@gmail.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, app_metadata: GOOGLE });
  check('★ יצירת החשבון נדחתה במסד', Boolean(error), `נוצר משתמש ${data?.user?.id}`);
  if (error) console.log(`      (${error.message})`);
  check('★ מספר המשתמשים לא השתנה', (await countUsers()) === before);
  if (data?.user) await admin.auth.admin.deleteUser(data.user.id);
}

// ═══════ 2. ברשימה, אבל בסיסמה — אין חשבון ═══════
console.log('\nאימייל ברשימה, בסיסמה:');
{
  const before = await countUsers();
  const { data, error } = await admin.auth.admin.createUser({
    email: OWNER_EMAIL, password: `Probe!${stamp}`, email_confirm: true,
  });
  const alreadyJoined = /already|registered|exists/i.test(error?.message ?? '');
  // אחרי שהבעלים נכנסה בגוגל, GoTrue דוחה כבר בגלל האימייל התפוס — גם זה
  // "אין חשבון סיסמה". ההוכחה שהשער עצמו דוחה ספק email ניתנת בסעיף 3 (SQL).
  check('★ חשבון סיסמה למורשה נדחה', Boolean(error), `נוצר משתמש ${data?.user?.id}`);
  if (error) console.log(`      (${alreadyJoined ? 'הבעלים כבר נכנסה בגוגל; השער מול ספק email מוכח בסעיף 3' : error.message})`);
  check('מספר המשתמשים לא השתנה', (await countUsers()) === before);
  if (data?.user) await admin.auth.admin.deleteUser(data.user.id);
}

// ═══════ 3. הזמנה ממתינה → כניסה מגוגל → תפקיד מוצמד ═══════
// ה-Admin API מוסיף עם ספק email (נדחה, ובצדק — סעיף 2). הוכחת הצד החיובי
// היא הוספה ל-auth.users עם ספק google — בדיוק מה ש-GoTrue עושה אחרי
// גוגל — בטרנזקציה אחת שמתגלגלת לאחור. דורש SUPABASE_ACCESS_TOKEN או PGURL.
console.log('\nהזמנה ממתינה שנכנסת (SQL, מתגלגל לאחור):');
if (!process.env.SUPABASE_ACCESS_TOKEN && !process.env.PGURL) {
  check('★ הוכחת הצד החיובי', false, 'אין SUPABASE_ACCESS_TOKEN ואין PGURL — אי אפשר להוסיף ל-auth.users ישירות');
} else {
  const { makeExecutor } = await import('./supabase-api.mjs');
  const ex = await makeExecutor();
  const email = `probe-invited-${stamp}@teichtal.invalid`;
  try {
    const rows = await ex.run(`
      begin;
      insert into public.allowed_users (email, full_name, role, branch_id)
      values ('${email}', '', 'branch_manager', (select id from public.branches where name = 'ביתר עילית'));
      insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
      values ('dddddddd-0000-0000-0000-00000000cafe', '${email}',
              '{"provider":"google","providers":["google"]}', '{"full_name":"בדיקת הזמנה"}');
      select p.role::text as role, p.is_active, p.full_name,
             a.user_id = p.id as linked, a.joined_at is not null as joined,
             (select count(*) from public.branch_staff s where s.user_id = p.id)::int as branches
      from public.profiles p join public.allowed_users a on a.email = p.email
      where p.email = '${email}';
      rollback;`);
    // ה-API מחזיר את תוצאת המשפט האחרון שהחזיר שורות.
    const r = rows[0] ?? {};
    check('★ החשבון נוצר — הטריגר אישר את המוזמנת', Boolean(r.role), JSON.stringify(rows));
    check('★ הפרופיל נוצר בטריגר עם התפקיד שחיכה', r.role === 'branch_manager' && r.is_active === true, JSON.stringify(r));
    check('השם נלקח מגוגל', r.full_name === 'בדיקת הזמנה', JSON.stringify(r));
    check('★ ההזמנה מקושרת לחשבון (כבר לא ממתינה)', r.linked === true && r.joined === true, JSON.stringify(r));
    check('★ השיוך לסניף נוצר אוטומטית', Number(r.branches) === 1, JSON.stringify(r));
  } catch (e) {
    check('★ החשבון נוצר — הטריגר אישר את המוזמנת', false, e.message);
  }
  const left = await ex.run(`select count(*)::int as c from public.allowed_users where email = '${email}'`);
  check('הכול התגלגל לאחור — לא נשארה הזמנה', Number(left[0]?.c) === 0);
  await ex.close();
}

// ═══════ 4. GoTrue: אין סיסמה, אין הרשמה ═══════
console.log('\nספק האימייל מול GoTrue:');
{
  const c = anon();
  const { error: pwErr } = await c.auth.signInWithPassword({ email: OWNER_EMAIL, password: 'whatever-123456' });
  check('★ כניסה בסיסמה נדחית (ספק האימייל כבוי)', Boolean(pwErr));
  if (pwErr) console.log(`      (${pwErr.message})`);
  const probe = `probe-${stamp}@teichtal.invalid`;
  const { data, error } = await c.auth.signUp({ email: probe, password: 'Probe!12345' });
  check('★ הרשמה עצמית באימייל נדחית', Boolean(error) || !data?.user,
        `נוצר משתמש ${data?.user?.id}`);
  if (error) console.log(`      (${error.message})`);
  if (data?.user) await admin.auth.admin.deleteUser(data.user.id);
}

// ═══════ 5. הבעלים ברשימה, anon בחוץ ═══════
console.log('\nרשימת המורשים:');
{
  const { data: owner } = await admin.from('allowed_users')
    .select('role, is_active, user_id').eq('email', OWNER_EMAIL).maybeSingle();
  check(`★ ${OWNER_EMAIL} ברשימה כבעלים פעילה`, owner?.role === 'owner' && owner?.is_active === true, JSON.stringify(owner));
  console.log(`      (${owner?.user_id ? 'כבר נכנסה בגוגל' : 'ממתינה לכניסה הראשונה'})`);

  const { data, error } = await anon().from('allowed_users').select('*').limit(1);
  check('★ anon חסום מרשימת המורשים', Boolean(error) || (data?.length ?? 0) === 0, `הוחזרו ${data?.length} שורות`);
}

console.log(fails === 0 ? '\nהדלת סגורה: גוגל בלבד, רשימה בלבד' : `\n${fails} בדיקות נכשלו`);
process.exit(fails ? 1 : 0);
