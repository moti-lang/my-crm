#!/usr/bin/env node
/**
 * Storage בענן: אף משתמשת — anon או מחוברת — לא מגיעה לקבצים.
 * הגיבויים (ובעתיד קבלות) חיים רק מאחורי service_role.
 *   1. HTTP עם מפתח anon: רשימה והורדה נדחות.
 *   2. SQL כ-authenticated (בעלים ומנהלת סניף, claims אמיתיים): storage.objects
 *      ריק לקריאה, וכתיבה נחסמת. זה בדיוק מה ש-Storage API מריץ בשם המשתמשת.
 *   3. אין דלי ציבורי, ואין policy על storage.objects (אף אחת לא נפתחה בטעות).
 */
import { makeExecutor, loadEnvFile, api } from './supabase-api.mjs';
loadEnvFile('.env.verify');
const ref = process.env.SUPABASE_PROJECT_REF, token = process.env.SUPABASE_ACCESS_TOKEN;
if (!ref || !token) { console.error('  ✗ חסרים SUPABASE_PROJECT_REF / SUPABASE_ACCESS_TOKEN'); process.exit(2); }
let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`); };
const keys = await api(token)('GET', `/v1/projects/${ref}/api-keys?reveal=true`);
const anon = (Array.isArray(keys) ? keys : []).find((k) => k.name === 'anon')?.api_key;
const base = `https://${ref}.supabase.co/storage/v1`;
const ex = await makeExecutor();
try {
  const objects = await ex.run(`select bucket_id, name from storage.objects order by created_at desc limit 1`);
  const sample = objects[0];
  // 1. anon
  const list = await fetch(`${base}/object/list/backups`, { method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' }, body: '{"prefix":""}' });
  const listed = await list.json().catch(() => null);
  check(`★ anon: רשימת backups נדחית או ריקה (HTTP ${list.status})`, !Array.isArray(listed) || listed.length === 0, JSON.stringify(listed).slice(0, 200));
  if (sample) {
    const dl = await fetch(`${base}/object/${sample.bucket_id}/${sample.name}`, { headers: { apikey: anon, Authorization: `Bearer ${anon}` } });
    check(`★ anon: הורדת ${sample.name} נדחית (HTTP ${dl.status})`, dl.status >= 400);
    const pub = await fetch(`${base}/object/public/${sample.bucket_id}/${sample.name}`);
    check(`★ כתובת ציבורית של הגיבוי לא עובדת (HTTP ${pub.status})`, pub.status >= 400);
  } else check('אין קבצים ב-Storage — בדיקת ההורדה דולגה', true);
  // 2. authenticated, claims אמיתיים של זהויות הבדיקה
  for (const role of ['owner', 'branch_manager', 'accountant']) {
    const rows = await ex.run(`
      begin;
      set local role authenticated;
      select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where role = '${role}' and email like '%@teichtal.local' limit 1), 'role', 'authenticated')::text, true);
      select (select count(*) from storage.objects) as visible, (select count(*) from storage.buckets) as buckets;
      rollback;`);
    const r = rows[0] ?? {};
    check(`★ ${role} מחוברת: רואה 0 קבצים ו-0 דליים`, Number(r.visible) === 0 && Number(r.buckets) === 0, JSON.stringify(r));
    const w = await ex.run(`
      begin;
      set local role authenticated;
      select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where role = '${role}' and email like '%@teichtal.local' limit 1), 'role', 'authenticated')::text, true);
      do $$ begin
        insert into storage.objects (bucket_id, name) values ('backups', 'attack.json');
        raise exception 'INSERTED';
      exception when insufficient_privilege then raise notice 'denied'; when others then if sqlerrm = 'INSERTED' then raise; end if; raise notice 'denied'; end $$;
      rollback;`).then(() => 'denied').catch((e) => e.message);
    check(`★ ${role} מחוברת: כתיבה ל-Storage נחסמת`, w === 'denied', w);
  }
  // 3. הגדרות
  const [{ n: pubBuckets }] = await ex.run(`select count(*)::int as n from storage.buckets where public`);
  check('אין דלי ציבורי', Number(pubBuckets) === 0);
  const [{ n: pols }] = await ex.run(`select count(*)::int as n from pg_policies where schemaname = 'storage'`);
  check('אין policy על storage.objects (אף פתיחה לא נוספה בטעות)', Number(pols) === 0);
} catch (e) { fails++; console.error(`  ✗ ${e.message}`); }
await ex.close();
console.log(fails ? `\n  ✗ ${fails} בדיקות Storage נכשלו` : '\n  ✓ Storage סגור: לא ל-anon, לא למחוברות');
process.exit(fails ? 1 : 0);
