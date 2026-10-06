#!/usr/bin/env node
// make-cloud-config.mjs — מכין את ה-cloud-config להקמת שרת הוואטסאפ.
//
//   node scripts/wa-server/make-cloud-config.mjs <נתיב לריפו whatsapp-hub> <קובץ פלט>
//
// 1. אורז את קוד ה-Hub (git archive של master — רק קבצים במעקב: בלי .env, session או נתונים).
// 2. מעלה ל-Storage, ל-bucket פרטי "deploy", ומפיק קישור חתום ל-7 ימים
//    (הריפו פרטי — השרת החדש לא יכול למשוך מגיטהאב).
// 3. מנפיק טוקן הקמה חד-פעמי (rpc_wa_issue_provision_token, 7 ימים; נשמר כ-hash).
// 4. משבץ את שלושתם ב-setup.sh ועוטף ב-cloud-config, להדבקה ב-Hetzner.
// ★ הפלט מכיל טוקן וקישור — לא לריפו. הוא תקף 7 ימים ונפסל בשימוש הראשון.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeExecutor, loadEnvFile } from '../supabase-api.mjs';

const [hubRepo, outFile] = process.argv.slice(2);
if (!hubRepo || !outFile) { console.error('שימוש: make-cloud-config.mjs <whatsapp-hub> <פלט>'); process.exit(2); }
const HERE = dirname(fileURLToPath(import.meta.url));
loadEnvFile(join(HERE, '../../.env.verify'));
const ref = process.env.SUPABASE_PROJECT_REF, token = process.env.SUPABASE_ACCESS_TOKEN;
const SB = `https://${ref}.supabase.co`;

const keys = await (await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`, { headers: { authorization: `Bearer ${token}` } })).json();
const service = keys.find((k) => k.name === 'service_role')?.api_key;
if (!service) throw new Error('אין מפתח service_role');
const H = { apikey: service, authorization: `Bearer ${service}` };

// 1 · אריזה
const tgz = execFileSync('git', ['-C', hubRepo, 'archive', '--format=tar.gz', 'master'], { maxBuffer: 64 << 20 });
const listing = execFileSync('git', ['-C', hubRepo, 'ls-tree', '-r', '--name-only', 'master'], { encoding: 'utf8' }).split('\n');
const bad = listing.filter((f) => /^(\.env$|auth\/|data\/|media\/)/.test(f));
if (bad.length) throw new Error(`בחבילה יש קבצים אסורים: ${bad.join(', ')}`);
const rev = execFileSync('git', ['-C', hubRepo, 'rev-parse', '--short', 'master'], { encoding: 'utf8' }).trim();
console.log(`  ✓ קוד ה-Hub ארוז (${rev}, ${(tgz.length / 1024).toFixed(0)} KB, ${listing.filter(Boolean).length} קבצים)`);

// 2 · Storage פרטי + קישור חתום
await fetch(`${SB}/storage/v1/bucket`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ id: 'deploy', name: 'deploy', public: false }) });
const path = `whatsapp-hub-${rev}.tar.gz`;
const up = await fetch(`${SB}/storage/v1/object/deploy/${path}`, { method: 'POST', headers: { ...H, 'content-type': 'application/gzip', 'x-upsert': 'true' }, body: tgz });
if (!up.ok) throw new Error(`העלאה נכשלה: ${up.status} ${await up.text()}`);
const signed = await (await fetch(`${SB}/storage/v1/object/sign/deploy/${path}`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ expiresIn: 7 * 24 * 3600 }) })).json();
if (!signed.signedURL) throw new Error(`קישור חתום נכשל: ${JSON.stringify(signed)}`);
const tarUrl = `${SB}/storage/v1${signed.signedURL}`;
const check = await fetch(tarUrl, { method: 'GET' });
if (!check.ok) throw new Error(`הקישור החתום לא עובד: ${check.status}`);
console.log('  ✓ הועלה ל-Storage פרטי, קישור חתום ל-7 ימים (נבדק)');

// 3 · טוקן הקמה
const x = await makeExecutor();
const rows = await x.run('select rpc_wa_issue_provision_token(168) as t');
const provisionToken = rows[0]?.t;
if (!/^[0-9a-f]{64}$/.test(provisionToken ?? '')) throw new Error('טוקן הקמה לא הונפק');
console.log('  ✓ טוקן הקמה חד-פעמי הונפק (7 ימים)');

// 4 · cloud-config
const script = readFileSync(join(HERE, 'setup.sh'), 'utf8')
  .replace('__HUB_TARBALL_URL__', tarUrl)
  .replace('__PROVISION_URL__', `${SB}/functions/v1/wa-provision`)
  .replace('__PROVISION_TOKEN__', provisionToken)
  .replace('__WEBHOOK_URL__', `${SB}/functions/v1/wa-webhook`);
if (/__[A-Z_]+__/.test(script)) throw new Error('נשאר placeholder בסקריפט');
const cloudConfig = `#cloud-config
# שרת וואטסאפ ל-CRM. רץ פעם אחת ביצירת השרת. לוג: /var/log/wa-setup.log
write_files:
  - path: /root/wa-setup.sh
    permissions: '0700'
    encoding: b64
    content: ${Buffer.from(script).toString('base64')}
runcmd:
  - [bash, /root/wa-setup.sh]
`;
if (cloudConfig.length > 32 * 1024) throw new Error(`cloud-config גדול מ-32KB (${cloudConfig.length})`);
writeFileSync(outFile, cloudConfig, { mode: 0o600 });
console.log(`  ✓ ${outFile} (${(cloudConfig.length / 1024).toFixed(1)} KB)`);
