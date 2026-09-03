#!/usr/bin/env node
/**
 * מחליף את הסיסמאות של משתמשי ה-seed. חובה לפני מסירה ללקוחה.
 *
 * הסיסמה 'Teichtal!2026' כתובה ב-seed-users.mjs, ב-verify-login.mjs
 * וב-README — כלומר בגיט, לכל מי שרואה את המאגר. מערכת שנמסרת עם
 * הסיסמה הזו פתוחה לכל מי שקרא את הקוד.
 *
 * ברירת המחדל: סיסמה אקראית חזקה לכל משתמש, מודפסת פעם אחת בלבד.
 * אפשר לקבוע סיסמה מפורשת למשתמש דרך משתני סביבה:
 *   SEED_PASSWORD_OWNER / SEED_PASSWORD_BRANCH_MANAGER / SEED_PASSWORD_ACCOUNTANT
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/rotate-seed-passwords.mjs
 *   npm run seed:rotate
 *
 * אחרי ההחלפה שלב 3 של סבב האימות (verify-login.mjs) לא יעבוד — הוא
 * מניח את סיסמת ה-seed. מריצים את סבב האימות קודם, ומחליפים אחרון.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { randomInt } from 'node:crypto';

// אותם שלושת המשתמשים של seed-users.mjs. שינוי שם — לשנות בשניהם.
const USERS = [
  { email: 'hania@teichtal.local',  role: 'owner' },
  { email: 'beitar@teichtal.local', role: 'branch_manager' },
  { email: 'books@teichtal.local',  role: 'accountant' },
];

const SEED_PASSWORD = 'Teichtal!2026';
const MIN_LENGTH = 12;

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

for (const key of Object.keys(process.env)) {
  if (key.startsWith('VITE_') && /SERVICE_ROLE|SECRET|PASSWORD/i.test(key)) {
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

// בלי תווים שמתבלבלים בהקראה בטלפון: 0/O, 1/l/I.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*-_=+';
function randomPassword(length = 20) {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  // מוודאים שיש לפחות אות, ספרה ותו מיוחד — אחרת מגרילים שוב.
  if (!/[A-Za-z]/.test(out) || !/[0-9]/.test(out) || !/[^A-Za-z0-9]/.test(out)) return randomPassword(length);
  return out;
}

function chosenPassword(role) {
  const fromEnv = process.env[`SEED_PASSWORD_${role.toUpperCase()}`];
  if (fromEnv === undefined || fromEnv === '') return { password: randomPassword(), generated: true };
  if (fromEnv === SEED_PASSWORD) throw new Error(`SEED_PASSWORD_${role.toUpperCase()} היא סיסמת ה-seed עצמה — זו לא החלפה`);
  if (fromEnv.length < MIN_LENGTH) throw new Error(`SEED_PASSWORD_${role.toUpperCase()} קצרה מ-${MIN_LENGTH} תווים`);
  return { password: fromEnv, generated: false };
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

async function findUser(email) {
  for (let page = 1; page <= 20; page++) {
    const { data: list, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`חיפוש ${email} נכשל: ${error.message}`);
    const found = list.users.find((u) => u.email === email);
    if (found) return found;
    if (list.users.length < 200) break;
  }
  return null;
}

async function main() {
  const results = [];

  for (const user of USERS) {
    const found = await findUser(user.email);
    if (!found) {
      console.warn(`  ! ${user.email} לא קיים — seed-users.mjs לא רץ? מדלגים`);
      continue;
    }
    const { password, generated } = chosenPassword(user.role);
    const { error } = await db.auth.admin.updateUserById(found.id, { password });
    if (error) throw new Error(`החלפת הסיסמה של ${user.email} נכשלה: ${error.message}`);

    // אימות: הסיסמה הישנה כבר לא נכנסת.
    const probe = createClient(url, process.env.SUPABASE_ANON_KEY ?? serviceKey, { auth: { persistSession: false } });
    const { error: oldErr } = await probe.auth.signInWithPassword({ email: user.email, password: SEED_PASSWORD });
    if (!oldErr) throw new Error(`${user.email} עדיין מתחבר עם סיסמת ה-seed אחרי ההחלפה`);
    await probe.auth.signOut().catch(() => {});

    results.push({ ...user, password, generated });
    console.log(`  ✓ ${user.email.padEnd(24)} ${user.role.padEnd(15)} ${generated ? 'סיסמה אקראית' : 'סיסמה ממשתנה סביבה'}`);
  }

  if (results.length === 0) {
    console.error('\n✗ לא הוחלפה אף סיסמה\n');
    process.exit(1);
  }

  console.log('\n═══ הסיסמאות החדשות — מוצגות פעם אחת בלבד, אינן נשמרות בשום מקום ═══\n');
  for (const r of results) console.log(`  ${r.email.padEnd(24)} ${r.password}`);
  console.log(
    '\nלמסור ללקוחה בערוץ מאובטח ולמחוק מהמסוף. אם אבדו — מריצים שוב.\n' +
      'שלב 3 של verify-cloud.sh לא יעבוד מעכשיו: הוא מניח את סיסמת ה-seed.\n',
  );
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}\n`);
  process.exit(1);
});
