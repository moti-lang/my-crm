#!/usr/bin/env node
/**
 * מתזמן את הבדיקה היזומה מול SUMIT: pg_cron קורא ל-cron-sumit-sync כל שעה,
 * עם אותו CRON_SECRET מה-Vault שהגיבוי משתמש בו (schedule-backup.mjs).
 * ומנפיק SUMIT_WEBHOOK_SECRET לפונקציה אם עדיין אין (מודפס פעם אחת —
 * זה מה שמזינים בטריגר ב-SUMIT, בכותרת x-webhook-secret).
 *   node scripts/schedule-sumit-sync.mjs [--remove]
 */
import { makeExecutor, loadEnvFile, api } from './supabase-api.mjs';
loadEnvFile('.env.verify');
const remove = process.argv.includes('--remove');
const JOB = 'teichtal-sumit-sync-hourly';
const ref = process.env.SUPABASE_PROJECT_REF, token = process.env.SUPABASE_ACCESS_TOKEN;
const ex = await makeExecutor();
try {
  await ex.run(`select cron.unschedule('${JOB}') where exists (select 1 from cron.job where jobname = '${JOB}')`).catch(() => {});
  if (remove) { console.log(`  ✓ ${JOB} בוטל`); await ex.close(); process.exit(0); }
  const [vault] = await ex.run(`select 1 as ok from vault.decrypted_secrets where name = 'teichtal_cron_secret'`);
  if (!vault) throw new Error('אין teichtal_cron_secret ב-Vault — להריץ קודם npm run backup:schedule');
  await ex.run(`
    select cron.schedule('${JOB}', '17 * * * *', $$
      select net.http_post(
        url := 'https://${ref}.supabase.co/functions/v1/cron-sumit-sync',
        headers := jsonb_build_object('Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'teichtal_cron_secret')),
        body := '{}'::jsonb, timeout_milliseconds := 120000)
    $$)`);
  const [job] = await ex.run(`select jobname, schedule, active from cron.job where jobname = '${JOB}'`);
  if (!job?.active) throw new Error('המשימה לא נרשמה');
  console.log(`  ✓ ${job.jobname} · ${job.schedule} · כל שעה`);
  const call = api(token);
  const secrets = await call('GET', `/v1/projects/${ref}/secrets`);
  if (!(Array.isArray(secrets) ? secrets : []).some((s) => s.name === 'SUMIT_WEBHOOK_SECRET')) {
    const secret = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
    await call('POST', `/v1/projects/${ref}/secrets`, [{ name: 'SUMIT_WEBHOOK_SECRET', value: secret }]);
    console.log(`  ✓ SUMIT_WEBHOOK_SECRET הונפק. להזין בטריגר של SUMIT בכותרת x-webhook-secret (מודפס פעם אחת):\nSUMIT_WEBHOOK_SECRET=${secret}`);
  } else console.log('  · SUMIT_WEBHOOK_SECRET כבר קיים');
} catch (e) { console.error(`  ✗ ${e.message}`); await ex.close(); process.exit(1); }
await ex.close();
