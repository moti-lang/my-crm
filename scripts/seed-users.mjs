#!/usr/bin/env node
/**
 * יוצר את משתמשי הבדיקה דרך ה-Admin API של Supabase.
 *
 * למה לא ב-seed.sql: כתיבה ישירה ל-auth.users מייצרת משתמש שנראה תקין
 * בטבלה אבל לא מצליח להתחבר — GoTrue דורש גם שורה תואמת ב-auth.identities,
 * והסכמה הזו משתנה בין גרסאות. auth.admin.createUser מטפל בשתיהן.
 *
 * הסקריפט אידמפוטנטי: הרצה חוזרת מעדכנת ולא מכפילה.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-users.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';

const PASSWORD = 'Teichtal!2026';

const USERS = [
  { email: 'hania@teichtal.local',  full_name: 'הניה טייכטל', phone: '972501234567', role: 'owner' },
  { email: 'beitar@teichtal.local', full_name: 'רבקי פרידמן',  phone: '972521111111', role: 'branch_manager', branch: 'ביתר עילית' },
  { email: 'books@teichtal.local',  full_name: 'שרה לוי',      phone: '972533333333', role: 'accountant' },
];

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, value] = m;
    if (!(key in process.env)) process.env[key] = value.replace(/^["']|["']$/g, '');
  }
}
loadEnvFile('.env.local');

// הגנה: מפתח service_role עם קידומת VITE_ נכנס לחבילת הדפדפן.
for (const key of Object.keys(process.env)) {
  if (key.startsWith('VITE_') && /SERVICE_ROLE|SECRET/i.test(key)) {
    console.error(`\n✗ ${key} — מפתח בקידומת VITE_ נארז לתוך קוד הדפדפן. הסירי אותו מיד.\n`);
    process.exit(1);
  }
}

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error(
    '\n✗ חסרים SUPABASE_URL או SUPABASE_SERVICE_ROLE_KEY.\n' +
      '  אפשר לשים אותם ב-.env.local (בלי קידומת VITE_) או להעביר בשורת הפקודה.\n',
  );
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

/** מחזיר את ה-UUID של המשתמש, בין אם נוצר עכשיו ובין אם כבר היה. */
async function ensureUser({ email, full_name }) {
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name },
  });
  if (!error) return { id: data.user.id, created: true };

  const alreadyExists = /already|registered|duplicate/i.test(error.message);
  if (!alreadyExists) throw new Error(`יצירת ${email} נכשלה: ${error.message}`);

  // כבר קיים — מאתרים את ה-UUID שלו.
  for (let page = 1; page <= 20; page++) {
    const { data: list, error: listErr } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (listErr) throw new Error(`חיפוש ${email} נכשל: ${listErr.message}`);
    const found = list.users.find((u) => u.email === email);
    if (found) return { id: found.id, created: false };
    if (list.users.length < 200) break;
  }
  throw new Error(`${email} מסומן כקיים אך לא נמצא ברשימת המשתמשים`);
}

async function main() {
  const ids = {};

  for (const user of USERS) {
    const { id, created } = await ensureUser(user);
    ids[user.role] = id;

    const { error } = await db.from('profiles').upsert(
      { id, full_name: user.full_name, phone: user.phone, role: user.role, is_active: true },
      { onConflict: 'id' },
    );
    if (error) throw new Error(`כתיבת הפרופיל של ${user.email} נכשלה: ${error.message}`);
    console.log(`  ${created ? '+' : '='} ${user.email.padEnd(24)} ${user.role.padEnd(15)} ${id}`);
  }

  // שיוך מנהלת הסניף לסניף שלה — הבסיס לכל בדיקות ה-RLS.
  for (const user of USERS.filter((u) => u.branch)) {
    const { data: branch, error: branchErr } = await db
      .from('branches').select('id').eq('name', user.branch).maybeSingle();
    if (branchErr) throw new Error(`חיפוש הסניף ${user.branch} נכשל: ${branchErr.message}`);
    if (!branch) {
      console.warn(`  ! הסניף "${user.branch}" לא נמצא — הרצת את seed.sql?`);
      continue;
    }
    const { error } = await db
      .from('branch_staff')
      .upsert({ branch_id: branch.id, user_id: ids[user.role] }, { onConflict: 'branch_id,user_id' });
    if (error) throw new Error(`שיוך ${user.branch} נכשל: ${error.message}`);
    console.log(`  → ${user.email} משויכת ל${user.branch}`);
  }

  // seed.sql משאיר created_by ריק כי אין לו את ה-UUID. ממלאים כאן.
  const { error: backfillErr, count } = await db
    .from('ledger_entries')
    .update({ created_by: ids.owner }, { count: 'exact' })
    .is('created_by', null);
  if (backfillErr) throw new Error(`מילוי created_by נכשל: ${backfillErr.message}`);
  console.log(`  → created_by מולא ב-${count ?? 0} רשומות כספים`);

  console.log(`\nמשתמשי הבדיקה מוכנים. סיסמה לכולם: ${PASSWORD}\n`);
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}\n`);
  process.exit(1);
});
