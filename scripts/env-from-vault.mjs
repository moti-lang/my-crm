#!/usr/bin/env node
/**
 * משחזר את .env.verify מה-Vault של הפרויקט — לקונטיינר חדש.
 *   SUPABASE_ACCESS_TOKEN=sbp_… SUPABASE_PROJECT_REF=… node scripts/env-from-vault.mjs
 * הטוקן עצמו הוא הדבר היחיד שצריך להביא מבחוץ (הוא מה שפותח את ה-Vault);
 * כל השאר (נטליפיי, SUMIT בדיקה, CRON_SECRET) נשמר שם ב-sandbox_<NAME>.
 * לשמירה/עדכון: node scripts/env-from-vault.mjs --save  (מ-.env.verify הנוכחי)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { makeExecutor, loadEnvFile, lit } from './supabase-api.mjs';
if (existsSync('.env.verify')) loadEnvFile('.env.verify');
if (!process.env.SUPABASE_ACCESS_TOKEN || !process.env.SUPABASE_PROJECT_REF) { console.error('  ✗ צריך SUPABASE_ACCESS_TOKEN ו-SUPABASE_PROJECT_REF בסביבה'); process.exit(2); }
const NAMES = ['NETLIFY_AUTH_TOKEN','NETLIFY_SITE_ID','SUMIT_TEST_COMPANY_ID','SUMIT_TEST_API_KEY','CRON_SECRET','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET'];
const ex = await makeExecutor();
if (process.argv.includes('--save')) {
  for (const n of NAMES) {
    const v = process.env[n]; if (!v) continue;
    const [row] = await ex.run(`select id from vault.decrypted_secrets where name = ${lit('sandbox_' + n)}`);
    if (row?.id) await ex.run(`select vault.update_secret(${lit(row.id)}::uuid, ${lit(v)})`);
    else await ex.run(`select vault.create_secret(${lit(v)}, ${lit('sandbox_' + n)}, 'סוד של סביבת הפיתוח; env-from-vault.mjs')`);
    console.log('  ✓ נשמר', n);
  }
} else {
  const rows = await ex.run(`select name, decrypted_secret as v from vault.decrypted_secrets where name like 'sandbox_%'`);
  const lines = [`SUPABASE_PROJECT_REF=${process.env.SUPABASE_PROJECT_REF}`, `SUPABASE_ACCESS_TOKEN=${process.env.SUPABASE_ACCESS_TOKEN}`];
  for (const r of rows) { const n = r.name.replace(/^sandbox_/, ''); if (n !== 'SUPABASE_ACCESS_TOKEN') lines.push(`${n}=${r.v}`); }
  const existing = existsSync('.env.verify') ? readFileSync('.env.verify', 'utf8').split('\n').filter((l) => l.trim() && !lines.some((x) => x.startsWith(l.split('=')[0] + '='))) : [];
  writeFileSync('.env.verify', [...existing, ...lines].join('\n') + '\n');
  console.log(`  ✓ .env.verify שוחזר מה-Vault: ${rows.map((r) => r.name.replace(/^sandbox_/, '')).join(', ')}`);
}
await ex.close();
