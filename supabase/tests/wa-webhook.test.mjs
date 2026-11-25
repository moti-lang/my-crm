#!/usr/bin/env node
/**
 * ★ wa-webhook (verify_jwt = false): ההגנה היחידה היא חתימת ה-HMAC של GOWA — ולכן היא חייבת לרוץ
 *   לפני כל נגיעה במסד. כאן הלוגיקה האמיתית (_shared/wa-webhook-core.ts) רצה מול מסד מזויף שסופר
 *   כל יצירת לקוח וכל קריאה: בקשה בלי חתימה תקינה → 401, ו-0 נגיעות במסד.
 *   החתימה נבנית כאן בדיוק כמו ב-GOWA (infrastructure/whatsapp/webhook.go):
 *   X-Hub-Signature-256: "sha256=" + hex(HMAC-SHA256(secret, raw body)).
 *   node supabase/tests/wa-webhook.test.mjs
 */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AI_DRY_RUN = 'true';
const SECRET = 'whsec-test-7f3a';
const out = join(mkdtempSync(join(tmpdir(), 'wa-hook-')), 'core.mjs');
execFileSync('npx', ['esbuild', 'supabase/functions/_shared/wa-webhook-core.ts', '--bundle', '--format=esm', `--outfile=${out}`,
  '--log-level=error', '--define:Deno.env.get=__denoEnvGet', '--banner:js=const __denoEnvGet = (k) => process.env[k];'], { stdio: 'inherit' });
const { handleWaWebhook } = await import(out);

let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`); };

/** מסד מזויף: כל שרשרת (from(...).insert(...).eq(...)…) נרשמת ומחזירה { data: null, error: null }. */
function fakeDb(opts = {}) {
  const log = [];
  const chain = (path) => new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') {
        const res = opts.answer?.(path) ?? { data: null, error: null };
        return (ok) => Promise.resolve(res).then(ok);
      }
      return (...args) => { const p = [...path, [prop, args]]; log.push(p); return chain(p); };
    },
  });
  return { log, db: new Proxy({}, { get: (_t, prop) => (...args) => { const p = [[prop, args]]; log.push(p); return chain(p); } }) };
}
const sign = (body, secret = SECRET) => 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
async function call(body, headers = {}, opts = {}) {
  const f = fakeDb(opts);
  let created = 0;
  const sent = [];
  const provider = () => ({ sendText: async (to, text) => { sent.push({ to, text }); return { ok: true, providerMsgId: null, dryRun: true }; } });
  const res = await handleWaWebhook(new Request('https://x.test/functions/v1/wa-webhook', { method: 'POST', body, headers }),
    { db: () => { created++; return f.db; }, provider });
  return { status: res.status, json: await res.json(), created, log: f.log, sent };
}
const MSG = JSON.stringify({ event: 'message', device_id: '972501112233@s.whatsapp.net', payload: {
  id: '3EB0C127D7BACC83D6A1', chat_id: '972521234567@s.whatsapp.net', from: '972521234567@s.whatsapp.net',
  from_name: 'רחלי', timestamp: '2026-11-25T10:00:00Z', is_from_me: false, body: 'שלום, מה שעות החוג?' } });

console.log('\n★ בלי חתימה תקינה — 401, ו-0 נגיעות במסד:');
process.env.WA_WEBHOOK_SECRET = SECRET;
{
  const cases = [
    ['בלי כותרת חתימה', {}],
    ['חתימה בסוד אחר', { 'x-hub-signature-256': sign(MSG, 'other-secret') }],
    ['חתימה על גוף אחר (הגוף שונה אחרי החתימה)', { 'x-hub-signature-256': sign(MSG.replace('שלום', 'שלוםם')) }],
    ['חתימה בלי הקידומת sha256=', { 'x-hub-signature-256': sign(MSG).slice(7) }],
    ['חתימה קטועה', { 'x-hub-signature-256': sign(MSG).slice(0, 40) }],
    ['כותרת ישנה (x-hub-signature של השרת הקודם)', { 'x-hub-signature': sign(MSG) }],
  ];
  for (const [label, headers] of cases) {
    const r = await call(MSG, headers);
    check(`★ ${label}: 401, בלי לקוח מסד, 0 קריאות`, r.status === 401 && r.created === 0 && r.log.length === 0, JSON.stringify({ s: r.status, c: r.created, n: r.log.length }));
  }
  delete process.env.WA_WEBHOOK_SECRET;
  const r = await call(MSG, { 'x-hub-signature-256': sign(MSG) });
  check('★ WA_WEBHOOK_SECRET לא מוגדר — הכל נדחה (401), 0 נגיעות', r.status === 401 && r.created === 0 && r.log.length === 0);
  process.env.WA_WEBHOOK_SECRET = SECRET;
  const g = await handleWaWebhook(new Request('https://x.test/h', { method: 'GET' }), { db: () => { throw new Error('db!'); }, provider: () => null });
  check('GET — 405, בלי מסד', g.status === 405);
}

console.log('\nחתימה תקינה:');
{
  const r = await call(MSG, { 'x-hub-signature-256': sign(MSG) });
  const ins = r.log.find((p) => p[0][0] === 'from' && p[0][1][0] === 'wa_messages' && p[1]?.[0] === 'insert');
  const row = ins?.[1][1][0];
  check('★ התקבלה ונשמרה: טלפון מנורמל, מזהה ההודעה של GOWA, הטקסט', r.status === 200 && row?.direction === 'in' && row.phone === '972521234567'
        && row.provider_msg_id === '3EB0C127D7BACC83D6A1' && row.body === 'שלום, מה שעות החוג?', JSON.stringify(row));
  check('חתימה באותיות גדולות (Hex) — מתקבלת', (await call(MSG, { 'x-hub-signature-256': sign(MSG).toUpperCase().replace('SHA256=', 'sha256=') })).status === 200);
  const dup = await call(MSG, { 'x-hub-signature-256': sign(MSG) }, {
    answer: (path) => (path[0][1][0] === 'wa_messages' && path[1]?.[0] === 'insert' ? { data: null, error: { code: '23505', message: 'dup' } } : null),
  });
  check('★ מסירה חוזרת (GOWA מנסה שוב) — כפילות, בלי עיבוד שני', dup.status === 200 && dup.json.duplicate === true && dup.sent.length === 0);
  const mine = JSON.stringify({ event: 'message', payload: { id: 'X', from: '972501112233@s.whatsapp.net', chat_id: '972521234567@s.whatsapp.net', is_from_me: true, body: 'x' } });
  const m = await call(mine, { 'x-hub-signature-256': sign(mine) });
  check('הודעה שלי — מאושרת (200) ולא נוגעת במסד', m.status === 200 && m.created === 0);
  const grp = JSON.stringify({ event: 'message', payload: { id: 'G', from: '972521234567@s.whatsapp.net', chat_id: '1203@g.us', body: 'x' } });
  check('קבוצה — מאושרת ולא נוגעת במסד', (await call(grp, { 'x-hub-signature-256': sign(grp) })).created === 0);
  const bad = '{not json';
  const b = await call(bad, { 'x-hub-signature-256': sign(bad) });
  check('JSON פגום (חתום) — 400, בלי מסד', b.status === 400 && b.created === 0);
  const paused = await call(MSG, { 'x-hub-signature-256': sign(MSG) }, {
    answer: (path) => (path[0][1][0] === 'settings' ? { data: { value: true }, error: null } : null),
  });
  check('★ הבוט כבוי — לא נשמרת ולא נענית', paused.json.ignored === 'bot_paused' && !paused.log.some((p) => p[0][1][0] === 'wa_messages'));
  const out = JSON.stringify({ event: 'device.logged_out', session_id: 'teichtal', payload: {} });
  const d = await call(out, { 'x-hub-signature-256': sign(out) });
  const alert = d.log.find((p) => p[0][1][0] === 'system_alerts' && p[1]?.[0] === 'insert');
  check('★ המכשיר נותק — בריאות "down" והתראה קריטית', d.status === 200 && d.json.device === 'logged_out'
        && d.log.some((p) => p[0][1][0] === 'settings' && p[1]?.[0] === 'upsert' && p[1][1][0]?.value?.status === 'down')
        && alert?.[1][1][0]?.severity === 'critical', JSON.stringify(d.log.map((p) => p.map((x) => x[0]).join('.'))));
  const lid = JSON.stringify({ event: 'message', payload: { id: 'L', from: '2515@lid', chat_id: '2515@lid', body: 'x' } });
  const l = await call(lid, { 'x-hub-signature-256': sign(lid) });
  check('שולחת בלי מספר (LID בלבד) — לא מעובדת, התראה', l.json.skipped === 'lid_only' && l.log.some((p) => p[0][1][0] === 'system_alerts'));
}

console.log(fails === 0 ? '\nwa-webhook: הכל עבר' : `\n${fails} בדיקות נכשלו`);
process.exit(fails === 0 ? 0 : 1);
