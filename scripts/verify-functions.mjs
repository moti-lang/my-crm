#!/usr/bin/env node
/**
 * שלב 8 של סבב האימות — כל Edge Function פרוסה מסרבת בלי טוקן ומסרבת
 * למפתח ה-anon הציבורי. הרשימה נמשכת מהפרויקט, לא מהקוד: פונקציה
 * שנפרסה בדרך אחרת נבדקת גם היא.
 *   2xx = הדלת פתוחה = כישלון. 401/403 = טוב. 400/405 אינם הוכחה ונחשבים כשל.
 *   חריג אחד, מפורש: `enroll` — דף ההרשמה, ציבורי בכוונה. שם ההוכחה הפוכה:
 *   גוף זבל → 400 (שומר הצורה), וגוף הרשמה תקין → JSON של המסד (ok:false עם
 *   סניף שאינו קיים), כלומר הבקשה הגיעה ל-rpc_enroll עם הגבלות הקצב שלו.
 */
import { api, loadEnvFile } from './supabase-api.mjs';

loadEnvFile('.env.verify');
const ref = process.env.SUPABASE_PROJECT_REF, token = process.env.SUPABASE_ACCESS_TOKEN;
const anon = process.env.SUPABASE_ANON_KEY;
if (!ref || !token || !anon) { console.error('  ✗ חסרים SUPABASE_PROJECT_REF / SUPABASE_ACCESS_TOKEN / SUPABASE_ANON_KEY'); process.exit(2); }

const fns = await api(token)('GET', `/v1/projects/${ref}/functions`);
const base = `https://${ref}.supabase.co/functions/v1`;
let fails = 0;
const probe = async (slug, headers) => {
  const res = await fetch(`${base}/${slug}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{"text":"x"}' }).catch(() => null);
  return res ? res.status : 0;
};
console.log(`  ${fns.length} פונקציות פרוסות`);
const PUBLIC_BY_DESIGN = { enroll: async () => {
  const bad = await probe('enroll', {});
  const res = await fetch(`${base}/enroll`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ first_name: 'בדיקה', last_name: 'אוטומטית', grade: 'ד', school: 'x', phone: '0500000000', email: 'x@y.co', branch_id: '00000000-0000-0000-0000-000000000000', terms_accepted: true }) }).catch(() => null);
  const body = res ? await res.json().catch(() => null) : null;
  const ok = bad === 400 && res?.status === 200 && body?.ok === false && /סניף/.test(String(body?.error ?? ''));
  return { ok, detail: `גוף זבל → ${bad} · הרשמה לסניף לא קיים → ${res?.status ?? 0} ${JSON.stringify(body)}` };
} };
for (const f of fns) {
  if (PUBLIC_BY_DESIGN[f.slug]) {
    const r = await PUBLIC_BY_DESIGN[f.slug]();
    if (!r.ok) fails++;
    console.log(`  ${r.ok ? '✓' : '✗'} ${f.slug.padEnd(22)} ציבורי בכוונה: ${r.detail}${r.ok ? '' : '   ★ לא מתנהג כמצופה'}`);
    continue;
  }
  const noAuth = await probe(f.slug, {});
  const withAnon = await probe(f.slug, { authorization: `Bearer ${anon}`, apikey: anon });
  const ok = [401, 403].includes(noAuth) && [401, 403].includes(withAnon);
  if (!ok) fails++;
  console.log(`  ${ok ? '✓' : '✗'} ${f.slug.padEnd(22)} בלי טוקן → ${noAuth} · מפתח anon → ${withAnon}${ok ? '' : '   ★ דלת פתוחה'}`);
}
console.log(fails ? `\n  ✗ ${fails} פונקציות נענות למי שאינו מורשה` : '\n  ✓ כל הפונקציות מסרבות בלי טוקן ולמפתח anon');
process.exit(fails ? 1 : 0);
