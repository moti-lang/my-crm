#!/usr/bin/env node
/**
 * מיגרציות ו-seed דרך ה-Management API — המסלול השלישי של db-push.sh.
 *
 *   node scripts/db-push-api.mjs            # מיגרציות, בסדר, עצירה בראשונה שנופלת
 *   node scripts/db-push-api.mjs seed       # seed.sql רק אם המסד ריק מסניפים; seed_allowlist.sql תמיד
 *
 * אותה סמנטיקה כמו המסלול של psql:
 *   * כל מיגרציה היא שאילתה אחת → טרנזקציה משתמעת אחת. או שכולה
 *     הוחלה, או שכלום. הרישום ב-supabase_migrations.schema_migrations
 *     נמצא באותה שאילתה, ולכן אין מצב של "הוחלה אבל לא נרשמה".
 *   * מיגרציה שכבר רשומה לא רצה שוב. הרצה חוזרת היא no-op.
 *   * seed אינו אידמפוטנטי (מזהים קבועים, בלי on conflict) ולכן רץ
 *     רק כשאין סניפים. זו אותה הגנה ש-deploy.sh נותן ידנית.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { makeExecutor, lit } from './supabase-api.mjs';

const MIG_DIR = 'supabase/migrations';
const mode = process.argv[2] ?? 'migrate';

const ex = await makeExecutor();
try {
  if (mode === 'migrate') await migrate();
  else if (mode === 'seed') await seed();
  else { console.error(`✗ מצב לא מוכר: ${mode} (migrate | seed)`); process.exit(2); }
} catch (e) {
  console.error(`\n  ✗ ${e.message}\n`);
  await ex.close();
  process.exit(1);
}
await ex.close();

async function migrate() {
  await ex.run(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      statements text[],
      name text
    );`);
  const applied = new Set(
    (await ex.run('select version from supabase_migrations.schema_migrations')).map((r) => r.version),
  );

  const files = readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();
  let count = 0;
  for (const f of files) {
    const version = f.split('_')[0];
    if (applied.has(version)) { console.log(`  · ${f} — כבר הוחלה, מדלג`); continue; }
    console.log(`  · ${f}`);
    const sql = readFileSync(join(MIG_DIR, f), 'utf8');
    try {
      await ex.run(
        `${sql}\n;\ninsert into supabase_migrations.schema_migrations (version, name) ` +
        `values (${lit(version)}, ${lit(basename(f))}) on conflict (version) do nothing;`,
      );
    } catch (e) {
      throw new Error(
        `המיגרציה שנפלה: ${f}\n    ${e.message}\n` +
        '    שום שינוי מהקובץ הזה לא נשאר בבסיס הנתונים.',
      );
    }
    count++;
  }
  console.log(`  → ${count} מיגרציות חדשות הוחלו`);
}

async function seed() {
  const [{ c }] = await ex.run('select count(*)::int as c from public.branches');
  if (Number(c) > 0) { console.log(`  · כבר יש ${c} סניפים — seed.sql לא רץ שוב`); }
  else {
    await ex.run(readFileSync('supabase/seed.sql', 'utf8'));
    const [{ c: after }] = await ex.run('select count(*)::int as c from public.branches');
    if (Number(after) === 0) throw new Error('seed.sql רץ בלי שגיאה אבל אין סניפים — משהו לא נכון');
    console.log(`  → נתוני הבסיס נטענו (${after} סניפים)`);
  }
  // הבעלים הראשונה: אידמפוטנטי, רץ תמיד.
  await ex.run(readFileSync('supabase/seed_allowlist.sql', 'utf8'));
  const owners = await ex.run(`select email from public.allowed_users where role = 'owner' and is_active`);
  if (owners.length === 0) throw new Error('seed_allowlist.sql רץ אבל אין בעלים פעילה ברשימה');
  console.log(`  → רשימת המורשים: בעלים ${owners.map((o) => o.email).join(', ')}`);
}
