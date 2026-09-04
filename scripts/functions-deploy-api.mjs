#!/usr/bin/env node
/**
 * פריסת Edge Functions דרך ה-Management API — כשה-CLI אינו זמין
 * (סנדבוקס, CI מוגבל: `supabase functions deploy` לא מוריד את הבינארי).
 *
 *   node scripts/functions-deploy-api.mjs                 # כל הפונקציות
 *   node scripts/functions-deploy-api.mjs ai-answer wa-webhook
 *
 * כל פונקציה נפרסת עם כל _shared/ (הייבואים יחסיים), ו-verify_jwt
 * נלקח מ-config.toml — אותו מקור אמת כמו ב-CLI. סודות אינם נוגעים כאן:
 * הם נקבעים ב-deploy.sh (`supabase secrets set`) או בדשבורד.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { api, assertTarget, loadEnvFile } from './supabase-api.mjs';

loadEnvFile('.env.verify');
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;
if (!token || !ref) { console.error('  ✗ חסרים SUPABASE_ACCESS_TOKEN או SUPABASE_PROJECT_REF'); process.exit(2); }

const ROOT = 'supabase/functions';
const all = readdirSync(ROOT).filter((d) => !d.startsWith('_') && statSync(join(ROOT, d)).isDirectory()
  && readdirSync(join(ROOT, d)).includes('index.ts'));
const wanted = process.argv.slice(2);
const slugs = wanted.length ? wanted : all;
const unknown = slugs.filter((s) => !all.includes(s));
if (unknown.length) { console.error(`  ✗ פונקציות לא קיימות: ${unknown.join(', ')}`); process.exit(2); }

/** verify_jwt מ-config.toml, ברירת מחדל true (כמו ה-CLI). */
const toml = readFileSync('supabase/config.toml', 'utf8').replace(/#[^\n]*/g, '');
function verifyJwt(slug) {
  const m = toml.match(new RegExp(`\\[functions\\.${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]([^\\[]*)`));
  if (!m) return true;
  const v = m[1].match(/verify_jwt\s*=\s*(true|false)/);
  return v ? v[1] === 'true' : true;
}

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** אין פריסה בלי שומר. אותו כלל כמו function-guards.test.mjs. */
const GUARD = { 'wa-webhook': 'verifyHubSignature', 'ai-answer': 'requireUserJwt', 'ai-command': 'requireUserJwt' };
function guardOf(slug) {
  const src = readFileSync(join(ROOT, slug, 'index.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const want = GUARD[slug] ?? 'requireCronSecret';
  return src.includes(`${want}(`) ? want : null;
}
const unguarded = slugs.filter((s) => !guardOf(s));
if (unguarded.length) {
  console.error(`  ✗ לא פורסים פונקציה בלי שומר: ${unguarded.join(', ')} (ראה _shared/guard.ts)`);
  process.exit(1);
}

const call = api(token);
const project = await assertTarget(call, ref);
console.log(`  ✓ יעד מאומת: ${project.name} · ${ref}`);

const shared = walk(join(ROOT, '_shared')).filter((f) => f.endsWith('.ts'));
let failed = 0;
for (const slug of slugs) {
  const files = [...walk(join(ROOT, slug)).filter((f) => f.endsWith('.ts')), ...shared];
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({
    entrypoint_path: `${slug}/index.ts`, name: slug, verify_jwt: verifyJwt(slug),
  })], { type: 'application/json' }));
  for (const f of files) {
    const rel = f.slice(ROOT.length + 1);
    form.append('file', new Blob([readFileSync(f)], { type: 'text/typescript' }), rel);
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/functions/deploy?slug=${slug}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.status !== 'ACTIVE') {
    failed++;
    console.log(`    ✗ ${slug}: HTTP ${res.status} ${body.message ?? JSON.stringify(body).slice(0, 200)}`);
  } else {
    console.log(`    ✓ ${slug} · גרסה ${body.version} · verify_jwt=${body.verify_jwt}`);
  }
}
console.log(failed ? `\n  ✗ ${failed} פונקציות לא נפרסו` : `\n  ✓ ${slugs.length} פונקציות נפרסו`);
process.exit(failed ? 1 : 0);
