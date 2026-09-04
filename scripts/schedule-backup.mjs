#!/usr/bin/env node
/**
 * מתזמן את הגיבוי היומי בפרויקט: pg_cron קורא ל-cron-backup דרך pg_net.
 *   node scripts/schedule-backup.mjs            # יוצר/מעדכן
 *   node scripts/schedule-backup.mjs --remove   # מבטל
 *
 * ה-cron יורה ב-19:00 וב-20:00 UTC (שעון קיץ/חורף); הפונקציה עצמה רצה רק
 * כשבישראל 22:00 (backup-core.shouldRunNow). הסוד לקריאה (CRON_SECRET) מונפק
 * כאן, נקבע לפונקציה ונשמר ב-Vault — לא בטקסט של המשימה.
 *
 * להרצה ידנית: node scripts/schedule-backup.mjs --print-secret מדפיס אותו (לא נשמר בקובץ).
 */
import { makeExecutor, loadEnvFile, api } from './supabase-api.mjs';

loadEnvFile('.env.verify');
const ref = process.env.SUPABASE_PROJECT_REF;
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!ref || !token) { console.error('  ✗ חסרים SUPABASE_PROJECT_REF / SUPABASE_ACCESS_TOKEN'); process.exit(2); }
const remove = process.argv.includes('--remove');
const JOB = 'teichtal-backup-daily';

const ex = await makeExecutor();
try {
  await ex.run(`select cron.unschedule('${JOB}') where exists (select 1 from cron.job where jobname = '${JOB}')`).catch(() => {});
  if (remove) { console.log(`  ✓ ${JOB} בוטל`); await ex.close(); process.exit(0); }

  await ex.run(`create extension if not exists pg_cron; create extension if not exists pg_net;`);

  // סוד ייעודי לקריאה, שאנחנו מנפיקים: נקבע כסוד של הפונקציה (Management API)
  // ונשמר ב-Vault למשימה. לא מנחשים איזה מפתח הפלטפורמה מזריקה לפונקציה.
  const secret = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const call = api(token);
  await call('POST', `/v1/projects/${ref}/secrets`, [{ name: 'CRON_SECRET', value: secret }]);
  const [existing] = await ex.run(`select id from vault.decrypted_secrets where name = 'teichtal_cron_secret'`);
  if (existing?.id) await ex.run(`select vault.update_secret('${existing.id}'::uuid, '${secret}')`);
  else await ex.run(`select vault.create_secret('${secret}', 'teichtal_cron_secret', 'cron-backup bearer')`);
  await ex.run(`
    select cron.schedule('${JOB}', '0 19,20 * * *', $$
      select net.http_post(
        url := 'https://${ref}.supabase.co/functions/v1/cron-backup',
        headers := jsonb_build_object('Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'teichtal_cron_secret')),
        body := '{}'::jsonb, timeout_milliseconds := 120000)
    $$)`);
  const [job] = await ex.run(`select jobname, schedule, active from cron.job where jobname = '${JOB}'`);
  if (!job?.active) throw new Error('המשימה לא נרשמה');
  console.log(`  ✓ ${job.jobname} · ${job.schedule} UTC · הפונקציה רצה רק כשבישראל 22:00`);
  if (process.argv.includes('--print-secret')) console.log(`CRON_SECRET=${secret}`);
} catch (e) {
  console.error(`  ✗ ${e.message}`); await ex.close(); process.exit(1);
}
await ex.close();
