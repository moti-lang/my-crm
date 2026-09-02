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
 *   node scripts/supabase-project.mjs auth
 *     מוודא שההרשמה העצמית סגורה (disable_signup=true) — ההגדרה
 *     שקובעת בפרויקט מתארח היא בדשבורד, לא ב-config.toml. כאן היא
 *     נקבעת בקוד, כמו כל שינוי אחר. verify-login.mjs עדיין מנסה
 *     להירשם בפועל, כי זו הדרך היחידה לדעת.
 */
import { api, assertTarget } from './supabase-api.mjs';

const mode = process.argv[2];
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;
const log = (s) => console.error(s);

if (!token || !ref) { log('  ✗ חסרים SUPABASE_ACCESS_TOKEN או SUPABASE_PROJECT_REF'); process.exit(2); }
if (!['env', 'auth'].includes(mode)) { log('  ✗ מצב: env | auth'); process.exit(2); }

const call = api(token);
try {
  const project = await assertTarget(call, ref);
  log(`  ✓ יעד מאומת: ${project.name} · ${ref} · ${project.region ?? '?'}`);
  if (mode === 'env') await printEnv();
  else await ensureSignupClosed();
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

async function ensureSignupClosed() {
  const cfg = await call('GET', `/v1/projects/${ref}/config/auth`);
  if (cfg.disable_signup === true) { log('  ✓ הרשמה עצמית כבר סגורה'); return; }
  log(`  ! הרשמה עצמית פתוחה (disable_signup=${cfg.disable_signup}) — סוגר`);
  await call('PATCH', `/v1/projects/${ref}/config/auth`, { disable_signup: true });
  const after = await call('GET', `/v1/projects/${ref}/config/auth`);
  if (after.disable_signup !== true) throw new Error('העדכון לא נקלט — disable_signup עדיין לא true');
  log('  ✓ הרשמה עצמית נסגרה');
}
