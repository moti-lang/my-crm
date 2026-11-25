#!/usr/bin/env node
/**
 * ★ שכבת הוואטסאפ (_shared/wa.ts) מול GOWA מזויפת — כל בקשה נרשמת ונבדקת:
 *   כתובות ושיטות לפי התיעוד של v9.10.0, Basic Auth + X-Device-Id, הסיומת @s.whatsapp.net רק כאן,
 *   מצב "לא מוגדר" בלי קריסה ובלי פנייה, הרצה יבשה / מספר בדיקה, שגיאות (מה מותר לנסות שוב),
 *   QR שנשלף מהכתובת שלנו בלבד (לא מהמארח ש-GOWA מחזירה), והסיסמה לא דולפת להודעות שגיאה.
 *   node supabase/tests/wa-gowa.test.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codeOf } from './_code.mjs';

const out = join(mkdtempSync(join(tmpdir(), 'wa-gowa-')), 'wa.mjs');
execFileSync('npx', ['esbuild', 'supabase/functions/_shared/wa.ts', '--bundle', '--format=esm', `--outfile=${out}`,
  '--log-level=error', '--define:Deno.env.get=__denoEnvGet', '--banner:js=const __denoEnvGet = (k) => process.env[k];'], { stdio: 'inherit' });
const wa = await import(out);

let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`); };

const BASE = 'https://wa-teichtal.example.test', USER = 'crm', PASS = 'S3cr3t-pass!', DEV = 'teichtal';
const ENV_KEYS = ['WA_BASE_URL', 'WA_DEVICE_ID', 'WA_USER', 'WA_PASS', 'WA_TEST_PHONE', 'WA_DRY_RUN', 'WA_WEBHOOK_SECRET'];
function setEnv(vars) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, vars);
}
const CONFIGURED = { WA_BASE_URL: BASE, WA_DEVICE_ID: DEV, WA_USER: USER, WA_PASS: PASS };

// ─── GOWA מזויפת ───
let calls = [], routes = {};
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  let body = init.body;
  if (body instanceof FormData) body = Object.fromEntries([...body.entries()].map(([k, v]) => [k, v instanceof Blob ? `blob:${v.size}:${v.name ?? ''}` : v]));
  else if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* keep */ } }
  calls.push({ url: u, method: init.method ?? 'GET', headers, body });
  const r = routes[`${init.method ?? 'GET'} ${new URL(u).pathname}`] ?? routes[new URL(u).pathname];
  if (!r) return new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'no route' }), { status: 404 });
  return typeof r === 'function' ? r(u, init) : r();
};
const ok = (results) => () => new Response(JSON.stringify({ code: 'SUCCESS', message: 'Success', results }), { status: 200, headers: { 'content-type': 'application/json' } });
const fail = (status, message) => () => new Response(JSON.stringify({ code: 'ERR', message }), { status, headers: { 'content-type': 'application/json' } });
const reset = (r = {}) => { calls = []; routes = r; };
const p = () => wa.whatsappProvider();
const basic = `Basic ${Buffer.from(`${USER}:${PASS}`).toString('base64')}`;

console.log('\nלא מוגדר — בלי קריסה ובלי פנייה:');
{
  setEnv({}); reset();
  const s = await p().status();
  check('★ status: { configured: false }', s.configured === false);
  const send = await p().sendText('0521234567', 'שלום', 'k');
  check('★ שליחה: לא נשלח, "לא מוגדר" (מחכה בתור — לא כישלון)', send.ok === false && send.notConfigured === true && send.retryable === false);
  const h = await p().checkHealth();
  check('בריאות: not_configured', h.ok === false && h.state === 'not_configured');
  const q = await p().loginQr();
  check('QR: "לא מוגדר"', q.ok === false && q.notConfigured === true);
  const lo = await p().logout();
  check('ניתוק: "לא מוגדר"', lo.ok === false && lo.notConfigured === true);
  check('★ אף פנייה לרשת', calls.length === 0, JSON.stringify(calls));
  setEnv({ ...CONFIGURED, WA_PASS: '' });
  check('חסר אחד מהמשתנים (סיסמה ריקה) — לא מוגדר', wa.waConfig() === null);
  setEnv({ ...CONFIGURED, WA_BASE_URL: 'http://wa.example.test' });
  check('★ כתובת http (לא https) — לא מוגדר (הסיסמה לא יוצאת בטקסט גלוי)', wa.waConfig() === null);
  setEnv({ ...CONFIGURED, WA_BASE_URL: 'https://u:p@wa.example.test' });
  check('כתובת עם פרטי משתמש בתוכה — לא מוגדר', wa.waConfig() === null);
  setEnv({ ...CONFIGURED, WA_BASE_URL: `${BASE}/` });
  check('כתובת עם / בסוף — מנורמלת', wa.waConfig()?.baseUrl === BASE);
}

console.log('\nמי מקבלת הודעה אמיתית:');
{
  setEnv({ ...CONFIGURED }); reset({ 'POST /send/message': ok({ message_id: 'M1' }) });
  const r = await p().sendText('0521234567', 'שלום', 'k');
  check('★ בלי WA_DRY_RUN — הרצה יבשה (ברירת המחדל), שום פנייה', r.ok && r.dryRun === true && calls.length === 0);
  setEnv({ ...CONFIGURED, WA_DRY_RUN: 'false' }); reset({ 'POST /send/message': ok({ message_id: 'M1' }) });
  const r2 = await p().sendText('052-123-4567', 'שלום', 'k');
  check('WA_DRY_RUN=false — נשלח, עם מזהה ההודעה', r2.ok && r2.dryRun === false && r2.providerMsgId === 'M1');
  const c = calls[0];
  check('★ POST {בסיס}/send/message', c?.method === 'POST' && c.url === `${BASE}/send/message`, c?.url);
  check('★ Basic Auth + X-Device-Id', c?.headers.authorization === basic && c.headers['x-device-id'] === DEV);
  check('★ גוף: phone עם @s.whatsapp.net (מנורמל), message', c?.body?.phone === '972521234567@s.whatsapp.net' && c.body.message === 'שלום', JSON.stringify(c?.body));
  setEnv({ ...CONFIGURED, WA_TEST_PHONE: '+972 50 111 2233' }); reset({ 'POST /send/message': ok({ message_id: 'T1' }) });
  const other = await p().sendText('0521234567', 'הורה', 'k');
  const mine = await p().sendText('050-111-2233', 'בדיקה', 'k');
  check('★ מצב בדיקה: להורה — הרצה יבשה', other.ok && other.dryRun === true);
  check('★ מצב בדיקה: למספר הבדיקה (בכל פורמט) — נשלח באמת', mine.ok && mine.dryRun === false && calls.length === 1 && calls[0].body.phone === '972501112233@s.whatsapp.net');
  setEnv({ ...CONFIGURED, WA_TEST_PHONE: '0501112233', WA_DRY_RUN: 'false' }); reset({ 'POST /send/message': ok({}) });
  const other2 = await p().sendText('0521234567', 'הורה', 'k');
  check('★ מספר בדיקה גובר גם על WA_DRY_RUN=false — להורה לא יוצא', other2.ok && other2.dryRun === true && calls.length === 0);
  check('realSendAllowed בלי הגדרות — אף פעם', (setEnv({ WA_DRY_RUN: 'false' }), wa.realSendAllowed('0521234567') === false));
}

console.log('\nשגיאות — מה מותר לנסות שוב:');
{
  setEnv({ ...CONFIGURED, WA_DRY_RUN: 'false' });
  reset({ 'POST /send/message': fail(401, 'Unauthorized') });
  const a = await p().sendText('0521234567', 'x', 'k');
  check('401 — סיסמה שגויה, לא חוזרים, ולא מופיעה הסיסמה', !a.ok && !a.retryable && /WA_USER/.test(a.error) && !a.error.includes(PASS));
  reset({ 'POST /send/message': fail(400, 'Phone 972 is not on whatsapp') });
  const b = await p().sendText('0521234567', 'x', 'k');
  check('400 — לא חוזרים, עם ההודעה של GOWA', !b.ok && !b.retryable && b.error.includes('not on whatsapp'));
  reset({ 'POST /send/message': fail(503, 'busy') });
  const c = await p().sendText('0521234567', 'x', 'k');
  check('503 (שער / עומס) — מותר לנסות שוב', !c.ok && c.retryable === true && !c.uncertain);
  reset({ 'POST /send/message': () => { throw new Error('timeout'); } });
  const d = await p().sendText('0521234567', 'x', 'k');
  check('★ אין תשובה (פג זמן) — "לא ברור אם נשלחה", לא חוזרים (אין מפתח ייחודיות ב-GOWA)', !d.ok && d.uncertain === true && d.retryable === false);
  reset({ 'POST /send/message': fail(500, 'internal') });
  const e = await p().sendText('0521234567', 'x', 'k');
  check('500 — לא חוזרים (GOWA עיבדה ונכשלה)', !e.ok && e.retryable === false);
}

console.log('\nתמונה וקובץ:');
{
  setEnv({ ...CONFIGURED, WA_DRY_RUN: 'false' }); reset({ 'POST /send/image': ok({ message_id: 'I1' }), 'POST /send/file': ok({ message_id: 'F1' }) });
  const i = await p().sendMedia('0521234567', { kind: 'image', url: 'https://files.example.test/a.png', caption: 'קבלה' }, 'k');
  check('★ תמונה מכתובת: POST /send/image, multipart: phone, caption, image_url', i.ok && calls[0].url === `${BASE}/send/image`
        && calls[0].body.phone === '972521234567@s.whatsapp.net' && calls[0].body.caption === 'קבלה' && calls[0].body.image_url === 'https://files.example.test/a.png', JSON.stringify(calls[0]?.body));
  check('multipart — בלי content-type ידני (הגבול נקבע אוטומטית), עם האימות', !('content-type' in calls[0].headers) && calls[0].headers.authorization === basic);
  const f = await p().sendMedia('0521234567', { kind: 'file', data: new Blob([new Uint8Array([1, 2, 3])]), filename: 'doc.pdf' }, 'k');
  check('★ קובץ: POST /send/file עם הקובץ עצמו', f.ok && calls[1].url === `${BASE}/send/file` && /^blob:3:doc\.pdf$/.test(calls[1].body.file), JSON.stringify(calls[1]?.body));
  const both = await p().sendMedia('0521234567', { kind: 'image' }, 'k');
  const http = await p().sendMedia('0521234567', { kind: 'image', url: 'http://x.test/a.png' }, 'k');
  check('בלי תוכן ובלי כתובת — שגיאה; כתובת http — שגיאה; בלי פנייה', !both.ok && !http.ok && calls.length === 2);
  setEnv({ ...CONFIGURED }); reset();
  const dry = await p().sendMedia('0521234567', { kind: 'image', url: 'https://files.example.test/a.png' }, 'k');
  check('הרצה יבשה — גם תמונה לא יוצאת', dry.ok && dry.dryRun && calls.length === 0);
}

console.log('\nמצב חיבור:');
{
  setEnv({ ...CONFIGURED }); reset({ 'GET /app/status': ok({ is_connected: true, is_logged_in: true, device_id: DEV, jid: '972501112233:7@s.whatsapp.net' }) });
  const s = await p().status();
  check('★ GET /app/status (גם בהרצה יבשה), עם אימות', calls[0]?.method === 'GET' && calls[0].url === `${BASE}/app/status` && calls[0].headers.authorization === basic && calls[0].headers['x-device-id'] === DEV);
  check('מחובר, והמספר מנורמל (בלי :7@…)', s.configured && s.ok && s.connected && s.loggedIn && s.phone === '972501112233', JSON.stringify(s));
  check('בריאות: connected', (await p().checkHealth()).state === 'connected');
  reset({ 'GET /app/status': ok({ is_connected: true, is_logged_in: false, jid: '' }) });
  check('לא מקושר — logged_out (צריך QR)', (await p().checkHealth()).state === 'logged_out');
  reset({ 'GET /app/status': () => { throw new Error('ECONNREFUSED'); } });
  const h = await p().checkHealth();
  check('השרת לא עונה — unreachable', !h.ok && h.state === 'unreachable');
}

console.log('\nQR:');
{
  setEnv({ ...CONFIGURED });
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  reset({
    'GET /app/login': ok({ qr_link: 'http://evil.example.test:3000/statics/images/qrcode/scan-qr-1.png', qr_duration: 30 }),
    '/statics/images/qrcode/scan-qr-1.png': () => new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }),
  });
  const q = await p().loginQr();
  check('★ QR: תמונה (data URL) ומשך תוקף', q.ok && q.qrDataUrl === `data:image/png;base64,${Buffer.from(png).toString('base64')}` && q.durationSec === 30, JSON.stringify(q).slice(0, 120));
  check('★ התמונה נשלפת מהכתובת שלנו — לא מהמארח ש-GOWA החזירה (הסיסמה לא יוצאת למארח אחר)',
        calls.length === 2 && calls[1].url === `${BASE}/statics/images/qrcode/scan-qr-1.png` && calls.every((c) => !c.url.includes('evil')) && calls[1].headers.authorization === basic);
  reset({ 'GET /app/login': ok({ qr_link: 'https://x.test/other/path.png' }) });
  check('נתיב שאינו /statics — לא נשלף', (await p().loginQr()).ok === false && calls.length === 1);
  reset({ 'GET /app/login': ok({ qr_link: `${BASE}/statics/q.png` }), '/statics/q.png': () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }) });
  check('תשובה שאינה תמונה — לא מוצגת', (await p().loginQr()).ok === false);
  reset({ 'GET /app/login': fail(400, 'you are already logged in.') });
  const al = await p().loginQr();
  check('כבר מחובר — "כבר מחובר" (לא שגיאה)', !al.ok && al.alreadyLoggedIn === true);
  reset({ 'GET /app/logout': ok({}) });
  const lo = await p().logout();
  check('★ ניתוק: GET /app/logout', lo.ok && calls[0].url === `${BASE}/app/logout` && calls[0].method === 'GET');
}

console.log('\nהודעות נכנסות (פרסור):');
{
  const msg = { event: 'message', device_id: '972501112233@s.whatsapp.net', payload: { id: 'ABC', chat_id: '972521234567@s.whatsapp.net',
    from: '972521234567@s.whatsapp.net', from_name: 'רחלי', sender_display_name: 'רחלי כהן', timestamp: '2026-11-25T10:00:00Z', is_from_me: false, body: 'שלום' } };
  const e = wa.parseWebhookEvent(msg);
  check('★ הודעה: מזהה, שולחת מנורמלת, טקסט, שם', e.kind === 'message' && e.message.providerMsgId === 'ABC' && e.message.from === '972521234567' && e.message.body === 'שלום' && e.message.contactName === 'רחלי כהן');
  check('הודעה שלי — מתעלמים', wa.parseWebhookEvent({ ...msg, payload: { ...msg.payload, is_from_me: true } }).kind === 'ignore');
  check('קבוצה — מתעלמים', wa.parseWebhookEvent({ ...msg, payload: { ...msg.payload, chat_id: '120363@g.us' } }).kind === 'ignore');
  check('★ בלי מזהה — לא מעובדת (מניעת כפילויות)', wa.parseWebhookEvent({ ...msg, payload: { ...msg.payload, id: '' } }).kind === 'unparsable');
  check('★ LID בלבד (בלי מספר) — לא מעובדת', (() => { const x = wa.parseWebhookEvent({ ...msg, payload: { ...msg.payload, from: '25155@lid' } }); return x.kind === 'unparsable' && x.reason === 'lid_only'; })());
  check('ניתוק המכשיר — device/logged_out', (() => { const x = wa.parseWebhookEvent({ event: 'device.logged_out', payload: {} }); return x.kind === 'device' && x.state === 'logged_out'; })());
  check('אירוע אחר (קבלה / הקלדה) — מתעלמים', wa.parseWebhookEvent({ event: 'message.ack', payload: {} }).kind === 'ignore');
}

console.log('\nמבנה:');
{
  const files = ['wa-send/index.ts', 'wa-admin/index.ts', 'cron-wa-health/index.ts', 'wa-webhook/index.ts', '_shared/reply.ts', '_shared/wa-webhook-core.ts', 'cron-reminders/index.ts'];
  const leaks = files.filter((f) => /fetch\([^)]*(WA_BASE_URL|\/send\/|\/app\/)/.test(codeOf(`supabase/functions/${f}`)) || /WA_(USER|PASS|BASE_URL|DEVICE_ID)/.test(codeOf(`supabase/functions/${f}`)));
  check('★ רק wa.ts מדבר עם GOWA (אף קובץ אחר לא קורא את הסודות או פונה לכתובות שלה)', leaks.length === 0, leaks.join(', '));
  const admin = codeOf('supabase/functions/wa-admin/index.ts');
  const ownerAt = admin.indexOf("if (role !== 'owner') return json("), provAt = admin.indexOf('whatsappProvider()');
  check('★ wa-admin: בדיקת בעלים לפני כל פנייה ל-GOWA', ownerAt > 0 && provAt > ownerAt);
  check('★ wa-admin לא מחזירה סיסמה / שם משתמש לדפדפן', !/\b(pass|user)\b\s*:/.test(admin.slice(admin.indexOf('function view('))));
}

console.log(fails === 0 ? '\nשכבת הוואטסאפ (GOWA): הכל עבר' : `\n${fails} בדיקות נכשלו`);
process.exit(fails === 0 ? 0 : 1);
