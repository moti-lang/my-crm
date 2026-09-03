#!/usr/bin/env node
/**
 * הגדרות הפרויקט המתארח, דרך ה-Management API. שני מצבים:
 *
 *   node scripts/supabase-project.mjs env
 *     מדפיס ל-stdout שורות KEY=VALUE של המפתחות הציבוריים
 *     (SUPABASE_URL, SUPABASE_ANON_KEY וגרסאות ה-VITE_ שלהן), כדי
 *     ש-verify-cloud.sh יעשה להן eval. סטטוס נכתב ל-stderr.
 *     מפתח ה-anon מגיע מהמקור ולא מהעתקה ידנית.
 *
 *   node scripts/supabase-project.mjs service-key
 *     מפתח service_role ל-stdout, למשיכה בזמן ריצה בלבד.
 *
 *   node scripts/supabase-project.mjs auth
 *     קובע "גוגל בלבד": ספק האימייל כבוי (אין סיסמאות בכלל), ספק גוגל
 *     דולק עם GOOGLE_CLIENT_ID/SECRET, וכתובות החזרה (SITE_URL). ההגדרה
 *     שקובעת בפרויקט מתארח היא בדשבורד, לא ב-config.toml — כאן היא
 *     נקבעת בקוד, כמו כל שינוי אחר. verify-access.mjs מנסה בפועל.
 *
 *     disable_signup נשאר false בכוונה: כניסה ראשונה בגוגל היא טכנית
 *     הרשמה. מה שסוגר את הדלת הוא הטריגר על auth.users (מיגרציה 0014).
 */
import { api, assertTarget } from './supabase-api.mjs';

const mode = process.argv[2];
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;
const log = (s) => console.error(s);

if (!token || !ref) { log('  ✗ חסרים SUPABASE_ACCESS_TOKEN או SUPABASE_PROJECT_REF'); process.exit(2); }
if (!['env', 'auth', 'service-key'].includes(mode)) { log('  ✗ מצב: env | auth | service-key'); process.exit(2); }

const call = api(token);
try {
  const project = await assertTarget(call, ref);
  log(`  ✓ יעד מאומת: ${project.name} · ${ref} · ${project.region ?? '?'}`);
  if (mode === 'env') await printEnv();
  else if (mode === 'service-key') await printServiceKey();
  else await ensureGoogleOnly();
} catch (e) {
  log(`  ✗ ${e.message}`);
  process.exit(1);
}

async function printEnv() {
  const keys = await call('GET', `/v1/projects/${ref}/api-keys?reveal=true`);
  const list = Array.isArray(keys) ? keys : [];
  // עדיפות למפתח ה-anon המסורתי (JWT); אחרת מפתח publishable חדש.
  const anon =
    list.find((k) => k.name === 'anon' && k.api_key) ??
    list.find((k) => k.type === 'publishable' && k.api_key);
  if (!anon) {
    throw new Error(`לא נמצא מפתח anon/publishable. נמצאו: ${list.map((k) => `${k.name}/${k.type}`).join(', ') || 'כלום'}`);
  }
  const url = `https://${ref}.supabase.co`;
  log(`  ✓ מפתח ${anon.name} (${anon.type ?? 'legacy'}) נמשך מהפרויקט`);
  for (const [k, v] of [
    ['SUPABASE_URL', url], ['SUPABASE_ANON_KEY', anon.api_key],
    ['VITE_SUPABASE_URL', url], ['VITE_SUPABASE_ANON_KEY', anon.api_key],
  ]) console.log(`${k}='${v.replace(/'/g, '')}'`);
}

/** מפתח service_role ל-stdout בלבד — לשלבים שיוצרים זהויות. לא נכתב לקובץ. */
async function printServiceKey() {
  const keys = await call('GET', `/v1/projects/${ref}/api-keys?reveal=true`);
  const key = (Array.isArray(keys) ? keys : []).find((k) => k.name === 'service_role' && k.api_key);
  if (!key) throw new Error('לא נמצא מפתח service_role');
  process.stdout.write(key.api_key);
}

async function ensureGoogleOnly() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  const siteUrl = process.env.SITE_URL;
  const cfg = await call('GET', `/v1/projects/${ref}/config/auth`);

  const want = {
    disable_signup: false,
    external_email_enabled: false,
    external_google_enabled: true,
    ...(clientId ? { external_google_client_id: clientId } : {}),
    ...(secret ? { external_google_secret: secret } : {}),
    ...(siteUrl ? {
      site_url: siteUrl,
      uri_allow_list: [siteUrl, `${siteUrl}/**`, 'http://localhost:5173', 'http://localhost:5173/**'].join(','),
    } : {}),
  };

  if (!cfg.external_google_enabled && !clientId) {
    throw new Error('ספק גוגל כבוי ואין GOOGLE_CLIENT_ID ב-.env.verify — אי אפשר להדליק');
  }

  // את הסוד אי אפשר לקרוא בחזרה. הוא נשלח רק כשגוגל מודלק או כש-client_id משתנה.
  const googleChanged = !cfg.external_google_enabled || (clientId && cfg.external_google_client_id !== clientId);
  const diff = Object.entries(want).filter(([k, v]) =>
    k === 'external_google_secret' ? googleChanged : cfg[k] !== v);
  if (diff.length === 0) { log('  ✓ גוגל בלבד: ספק האימייל כבוי, גוגל דולק, כתובות החזרה במקום'); return; }

  log(`  ! מעדכן: ${diff.map(([k]) => k).join(', ')}`);
  await call('PATCH', `/v1/projects/${ref}/config/auth`, Object.fromEntries(diff));
  const after = await call('GET', `/v1/projects/${ref}/config/auth`);
  for (const [k, v] of Object.entries(want)) {
    if (k === 'external_google_secret') continue;
    if (after[k] !== v) throw new Error(`העדכון לא נקלט — ${k} הוא ${JSON.stringify(after[k])} ולא ${JSON.stringify(v)}`);
  }
  log('  ✓ גוגל בלבד: ספק האימייל כבוי, גוגל דולק, כתובות החזרה במקום');
}
