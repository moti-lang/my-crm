#!/usr/bin/env node
/**
 * מתזמן את שליחת תור המיילים להורים: pg_cron כל דקה, אבל קורא ל-cron-email רק כשיש
 * הודעה ממתינה (אחרת — אפס קריאות). אותו CRON_SECRET מה-Vault כמו הגיבוי.
 *   node scripts/schedule-email-queue.mjs [--remove]
 */
import { makeExecutor, loadEnvFile } from './supabase-api.mjs';
loadEnvFile('.env.verify');
const remove = process.argv.includes('--remove');
const JOB = 'teichtal-email-queue';
const ref = process.env.SUPABASE_PROJECT_REF;
const ex = await makeExecutor();
try {
  await ex.run(`select cron.unschedule('${JOB}') where exists (select 1 from cron.job where jobname = '${JOB}')`).catch(() => {});
  if (remove) { console.log(`  ✓ ${JOB} בוטל`); await ex.close(); process.exit(0); }
  const [vault] = await ex.run(`select 1 as ok from vault.decrypted_secrets where name = 'teichtal_cron_secret'`);
  if (!vault) throw new Error('אין teichtal_cron_secret ב-Vault — להריץ קודם npm run backup:schedule');
  await ex.run(`
    select cron.schedule('${JOB}', '* * * * *', $$
      select net.http_post(
        url := 'https://${ref}.supabase.co/functions/v1/cron-email',
        headers := jsonb_build_object('Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'teichtal_cron_secret')),
        body := '{}'::jsonb, timeout_milliseconds := 120000)
      where exists (select 1 from public.email_messages where status = 'queued')
    $$)`);
  const [job] = await ex.run(`select jobname, schedule, active from cron.job where jobname = '${JOB}'`);
  if (!job?.active) throw new Error('המשימה לא נרשמה');
  console.log(`  ✓ ${job.jobname} · ${job.schedule} · רק כשיש מיילים בתור`);
} catch (e) { console.error(`  ✗ ${e.message}`); await ex.close(); process.exit(1); }
await ex.close();
