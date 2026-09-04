#!/usr/bin/env node
/**
 * גיבוי מלא של המסד לקובץ מקומי.   npm run backup
 *
 * מה נכנס: כל הטבלאות ב-public (כולל allowed_users, settings, audit_log),
 * ו-auth.users + auth.identities — בלעדיהם המשתמשות לא יכולות להיכנס
 * אחרי שחזור, כי profiles מצביע על auth.users.
 *
 * הפורמט הוא JSON אחד עם manifest (פרויקט, זמן, ספירת שורות לכל טבלה),
 * כי הוא עובד בכל מסלול — Management API (רק HTTPS) או PGURL — ומשחזרים
 * אותו עם scripts/restore.mjs. אם pg_dump ו-SUPABASE_DB_URL זמינים, נוצר
 * בנוסף קובץ .dump של pg_dump — הדרך המהירה ביותר לשחזור מלא.
 *
 * הקובץ מכיל טלפונים, כתובות וכספים. הוא ב-.gitignore. לשמור במקום מוגן.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { makeExecutor, loadEnvFile } from './supabase-api.mjs';

loadEnvFile('.env.verify');
loadEnvFile('.env.local');
// PGURL מפורש מנצח: מי שנתן מחרוזת חיבור התכוון אליה, גם אם .env.verify
// מכיל טוקן לענן. (הלקח: שחזור שרץ על הענן במקום על המסד המקומי.)
if (process.env.PGURL) delete process.env.SUPABASE_ACCESS_TOKEN;
else if (process.env.SUPABASE_DB_URL && !process.env.SUPABASE_ACCESS_TOKEN) process.env.PGURL = process.env.SUPABASE_DB_URL;

const OUT_DIR = process.env.BACKUP_DIR ?? 'backups';
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const ex = await makeExecutor();

try {
  const tables = (await ex.run(`
    select tablename from pg_tables where schemaname = 'public' order by tablename`)).map((r) => r.tablename);
  // auth.identities קיימת בסופבייס; ה-shim המקומי מספק את שתיהן, כמו הענן.
  const authTables = (await ex.run(`select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='auth' and c.relkind='r' and relname in ('users','identities') order by 1 desc`)).map((r) => r.relname);

  const data = {};
  const counts = {};
  // row_to_json בצד המסד: חותמות זמן במיקרו-שניות ומספרים כפי שהם. דרך
  // הדרייבר של pg חותמת זמן הופכת ל-Date ומאבדת מיקרו-שניות — והשחזור
  // לא היה זהה למקור.
  const dump = async (sql) => (await ex.run(`select row_to_json(x) as r from (${sql}) x`)).map((r) => r.r);
  for (const t of tables) {
    const rows = await dump(`select * from public.${quote(t)}`);
    data[`public.${t}`] = rows; counts[`public.${t}`] = rows.length;
    console.log(`  · public.${t.padEnd(22)} ${rows.length}`);
  }
  for (const t of authTables) {
    const rows = await dump(`select * from auth.${t}`);
    data[`auth.${t}`] = rows; counts[`auth.${t}`] = rows.length;
    console.log(`  · auth.${t.padEnd(24)} ${rows.length}`);
  }
  const [{ v }] = await ex.run(`select string_agg(version, ',' order by version) as v from supabase_migrations.schema_migrations`)
    .catch(() => [{ v: null }]);

  const manifest = {
    format: 'teichtal-backup/1',
    taken_at: new Date().toISOString(),
    source: ex.label === 'api' ? `supabase:${ex.ref}` : 'pg',
    migrations: v,
    counts,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const file = `${OUT_DIR}/teichtal-${stamp}.json`;
  writeFileSync(file, JSON.stringify({ manifest, data }));
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  console.log(`\n  ✓ ${file} — ${tables.length + authTables.length} טבלאות, ${total} שורות`);

  // בונוס: pg_dump מלא כשאפשר.
  if (process.env.SUPABASE_DB_URL && hasPgDump()) {
    const dump = `${OUT_DIR}/teichtal-${stamp}.dump`;
    execFileSync('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--schema=public',
      '--file', dump, process.env.SUPABASE_DB_URL], { stdio: 'inherit' });
    console.log(`  ✓ ${dump} — pg_dump של public (שחזור: pg_restore)`);
  }
  console.log('\nהקובץ מכיל מידע אישי. לשמור במקום מוגן, לא בגיט.\n');
} catch (e) {
  console.error(`\n  ✗ הגיבוי נכשל: ${e.message}\n`);
  await ex.close();
  process.exit(1);
}
await ex.close();

function quote(ident) { return `"${ident.replace(/"/g, '""')}"`; }
function hasPgDump() { try { execFileSync('pg_dump', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } }
