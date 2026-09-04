#!/usr/bin/env node
/**
 * מוריד גיבויים מ-Storage למחשב.   node scripts/backup-pull.mjs [מספר, ברירת מחדל 1]
 * דורש SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (או SUPABASE_ACCESS_TOKEN שממנו הם נמשכים).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { loadEnvFile, api } from './supabase-api.mjs';

loadEnvFile('.env.verify'); loadEnvFile('.env.local');
let url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if ((!url || !key) && process.env.SUPABASE_ACCESS_TOKEN && process.env.SUPABASE_PROJECT_REF) {
  const keys = await api(process.env.SUPABASE_ACCESS_TOKEN)('GET', `/v1/projects/${process.env.SUPABASE_PROJECT_REF}/api-keys?reveal=true`);
  key = (Array.isArray(keys) ? keys : []).find((k) => k.name === 'service_role')?.api_key;
  url = `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co`;
}
if (!url || !key) { console.error('  ✗ חסרים SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(2); }
const n = Number(process.argv[2] ?? 1);
const db = createClient(url, key, { auth: { persistSession: false } });
const { data: list, error } = await db.storage.from('backups').list('', { limit: 1000 });
if (error) { console.error(`  ✗ ${error.message}`); process.exit(1); }
const names = (list ?? []).map((o) => o.name).filter((x) => x.startsWith('teichtal-')).sort().slice(-n);
if (!names.length) { console.log('  · אין גיבויים ב-Storage'); process.exit(0); }
mkdirSync('backups', { recursive: true });
for (const name of names) {
  const { data, error: dErr } = await db.storage.from('backups').download(name);
  if (dErr || !data) { console.error(`  ✗ ${name}: ${dErr?.message}`); process.exit(1); }
  writeFileSync(`backups/${name}`, Buffer.from(await data.arrayBuffer()));
  console.log(`  ✓ backups/${name}`);
}
console.log('\nשחזור: npm run restore -- backups/<קובץ> --yes\n');
