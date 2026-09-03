#!/usr/bin/env node
/**
 * ★ גיבוי ← שיבוש ← שחזור ← זהה למקור. על המסד המקומי.
 *
 * הראיה: לא "הקובץ נוצר", אלא שאחרי מחיקת תלמידות, הסרת מורשה ושינוי
 * הגדרה, השחזור מחזיר כל טבלה לאותה ספירה ולאותו תוכן (md5 של כל השורות,
 * ממוינות). כולל auth.users והפרופילים, שעוברים דרך השער.
 *
 * הרצה:  npm run test:backup   (דורש פוסטגרס מקומי אחרי reset.sh)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PGHOST = process.env.PGHOST ?? '/tmp', PGPORT = process.env.PGPORT ?? '5433', PGUSER = process.env.PGUSER ?? 'postgres';
const PGURL = `postgresql://${PGUSER}${process.env.PGPASSWORD ? ':' + process.env.PGPASSWORD : ''}@/teichtal?host=${PGHOST}&port=${PGPORT}`;
const psql = (sql) => execFileSync('psql', ['-h', PGHOST, '-p', PGPORT, '-U', PGUSER, '-d', 'teichtal', '-tAc', sql], { encoding: 'utf8' }).trim();
const env = { ...process.env, PGURL, SUPABASE_ACCESS_TOKEN: '', BACKUP_DIR: mkdtempSync(join(tmpdir(), 'backup-')) };
const node = (args) => execFileSync('node', args, { encoding: 'utf8', env });

let fails = 0;
const check = (label, ok, detail = '') => {
  if (!ok) fails++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
};

/** חתימת תוכן לכל טבלה: md5 של כל השורות, ממוינות. */
function fingerprint() {
  const tables = psql(`select tablename from pg_tables where schemaname='public' order by 1`).split('\n');
  const fp = {};
  for (const t of [...tables.map((t) => `public.${t}`), 'auth.users']) {
    fp[t] = psql(`select coalesce(md5(string_agg(x::text, '|' order by x::text)), 'empty') || ':' || count(*) from ${t} x`);
  }
  return fp;
}

execFileSync('./supabase/tests/reset.sh', { stdio: 'ignore' });
const before = fingerprint();

console.log('\nגיבוי:');
const out = node(['scripts/backup.mjs']);
const file = readdirSync(env.BACKUP_DIR).find((f) => f.endsWith('.json'));
check('★ קובץ הגיבוי נוצר', Boolean(file), out.slice(-300));
check('הגיבוי מדווח על כל הטבלאות', /2\d טבלאות/.test(out));

console.log('\nשיבוש:');
psql(`delete from attendance; delete from students where full_name like 'ר%'; delete from allowed_users where email='books@teichtal.local';
      update settings set value='true' where key='agent_may_quote_prices'; delete from faq_entries;`);
const broken = fingerprint();
check('המסד באמת השתנה', JSON.stringify(broken) !== JSON.stringify(before));

console.log('\nשחזור:');
const dry = node(['scripts/restore.mjs', join(env.BACKUP_DIR, file)]);
check('בלי --yes: הרצה יבשה, כלום לא נוגע', /הרצה יבשה/.test(dry) && JSON.stringify(fingerprint()) === JSON.stringify(broken));
const res = node(['scripts/restore.mjs', join(env.BACKUP_DIR, file), '--yes']);
check('★ השחזור מדווח על התאמה מלאה למניפסט', /כולן תואמות למניפסט/.test(res), res.slice(-400));

const after = fingerprint();
const diff = Object.keys(before).filter((t) => before[t] !== after[t]);
check('★ כל טבלה זהה למקור, תוכן וספירה', diff.length === 0, `שונות: ${diff.join(', ')}`);
check('★ המשתמשות חזרו דרך השער עם אותם מזהים', psql(`select count(*) from profiles p join auth.users u on u.id=p.id`) === psql(`select count(*) from auth.users`));
check('הרשימה מקושרת לפרופילים', psql(`select count(*) from allowed_users where user_id is null`) === psql(`select count(*) from allowed_users a where not exists (select 1 from profiles p where p.email=a.email)`));

console.log(fails === 0 ? '\nגיבוי ושחזור: זהה למקור' : `\n${fails} בדיקות נכשלו`);
process.exit(fails ? 1 : 0);
