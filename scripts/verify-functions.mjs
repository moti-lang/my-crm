#!/usr/bin/env node
/**
 * שלב 8 של סבב האימות — כל Edge Function פרוסה מסרבת בלי טוקן ומסרבת
 * למפתח ה-anon הציבורי. הרשימה נמשכת מהפרויקט, לא מהקוד: פונקציה
 * שנפרסה בדרך אחרת נבדקת גם היא.
 *   2xx = הדלת פתוחה = כישלון. 401/403 = טוב. 400/405 אינם הוכחה ונחשבים כשל.
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
for (const f of fns) {
  const noAuth = await probe(f.slug, {});
  const withAnon = await probe(f.slug, { authorization: `Bearer ${anon}`, apikey: anon });
  const ok = [401, 403].includes(noAuth) && [401, 403].includes(withAnon);
  if (!ok) fails++;
  console.log(`  ${ok ? '✓' : '✗'} ${f.slug.padEnd(22)} בלי טוקן → ${noAuth} · מפתח anon → ${withAnon}${ok ? '' : '   ★ דלת פתוחה'}`);
}
console.log(fails ? `\n  ✗ ${fails} פונקציות נענות למי שאינו מורשה` : '\n  ✓ כל הפונקציות מסרבות בלי טוקן ולמפתח anon');
process.exit(fails ? 1 : 0);
