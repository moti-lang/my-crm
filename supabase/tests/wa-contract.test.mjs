#!/usr/bin/env node
/**
 * ★ חוזה מול GOWA v9.10.0 — מה ש-wa.ts שולח ומצפה לו, מול מה שנקבע בתיעוד ובקוד של GOWA
 *   (fixtures/gowa-contract.json — נלקח מ-docs/openapi.yaml, docs/webhook-payload.md והקוד בתגית).
 *   כתובות, שיטות, שמות שדות, כותרות, ושדות התשובה. והחתימה: נבנית כאן בדיוק כמו ב-GOWA
 *   (utils.GetMessageDigestOrSignature: hex של HMAC-SHA256) — ו-verifyWebhookSignature מקבלת אותה.
 *   החלפת גרסה של GOWA: לעדכן את הקובץ מהתגית החדשה, ולהריץ.
 *   node supabase/tests/wa-contract.test.mjs
 */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codeOf, rawOf } from './_code.mjs';

const C = JSON.parse(rawOf('supabase/tests/fixtures/gowa-contract.json'));
const out = join(mkdtempSync(join(tmpdir(), 'wa-c-')), 'wa.mjs');
execFileSync('npx', ['esbuild', 'supabase/functions/_shared/wa.ts', '--bundle', '--format=esm', `--outfile=${out}`,
  '--log-level=error', '--define:Deno.env.get=__denoEnvGet', '--banner:js=const __denoEnvGet = (k) => process.env[k];'], { stdio: 'inherit' });
const wa = await import(out);

let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`); };
console.log(`\nמקור: ${C.source}`);

// ─── מה wa.ts שולח בפועל ───
Object.assign(process.env, { WA_BASE_URL: 'https://gowa.test', WA_DEVICE_ID: 'd1', WA_USER: 'u', WA_PASS: 'p', WA_DRY_RUN: 'false', WA_WEBHOOK_SECRET: 's3cr3t' });
const seen = [];
globalThis.fetch = async (url, init = {}) => {
  let body = init.body;
  const kind = body instanceof FormData ? 'multipart' : typeof body === 'string' ? 'json' : 'none';
  if (body instanceof FormData) body = Object.fromEntries(body.entries()); else if (typeof body === 'string') body = JSON.parse(body);
  seen.push({ method: init.method ?? 'GET', path: new URL(url).pathname, kind, body, headers: Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])) });
  const path = new URL(url).pathname;
  const results = path === '/app/status' ? { is_connected: true, is_logged_in: true, jid: '972501112233@s.whatsapp.net' }
    : path === '/app/login' ? { qr_link: 'http://h/statics/q.png', qr_duration: 30 } : { message_id: 'MID' };
  if (path.startsWith('/statics/')) return new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': 'image/png' } });
  return new Response(JSON.stringify({ code: 'SUCCESS', message: 'Success', results }), { status: 200 });
};
const p = wa.whatsappProvider();
const sentText = await p.sendText('0521234567', 'x', 'k');
const sentImg = await p.sendMedia('0521234567', { kind: 'image', url: 'https://f.test/a.png', caption: 'c' }, 'k');
const sentFile = await p.sendMedia('0521234567', { kind: 'file', url: 'https://f.test/a.pdf', caption: 'c' }, 'k');
const st = await p.status();
const qr = await p.loginQr();
await p.logout();

console.log('\nכתובות, שיטות וגוף:');
const E = C.endpoints;
const byPath = (path) => seen.find((s) => s.path === path);
for (const [name, e] of Object.entries(E)) {
  const s = byPath(e.path);
  check(`★ ${name}: ${e.method} ${e.path}${e.body ? ` (${e.body})` : ''}`, s && s.method === e.method && (!e.body || s.kind === e.body), JSON.stringify(s && { m: s.method, k: s.kind }));
  if (e.fields && s) {
    const extra = Object.keys(s.body).filter((k) => !e.fields.includes(k));
    check(`   ${name}: רק שדות שקיימים בחוזה (${e.fields.join(', ')})`, extra.length === 0, `שדות לא מוכרים: ${extra.join(', ')}`);
  }
}
check('★ טקסט: phone ו-message (לא text / to)', byPath('/send/message')?.body?.phone?.endsWith(C.phone.jidSuffix) && byPath('/send/message').body.message === 'x');
check('★ שדות התשובה: results.message_id', sentText.providerMsgId === 'MID' && sentImg.providerMsgId === 'MID' && sentFile.providerMsgId === 'MID');
check('★ מצב: is_connected / is_logged_in / jid', st.ok && st.connected && st.loggedIn && st.phone === '972501112233');
check('★ QR: qr_link (נשלף מ-/statics בכתובת שלנו) ו-qr_duration', qr.ok && qr.durationSec === 30 && seen.some((s) => s.path === '/statics/q.png'));

console.log('\nאימות:');
const apiCalls = seen.filter((s) => !s.path.startsWith('/statics/'));
check(`★ ${C.auth.scheme === 'basic' ? 'Basic Auth' : C.auth.scheme} בכל קריאה`, apiCalls.every((s) => s.headers.authorization === `Basic ${Buffer.from('u:p').toString('base64')}`));
check(`★ ${C.auth.deviceHeader} בכל קריאה`, apiCalls.every((s) => s.headers[C.auth.deviceHeader.toLowerCase()] === 'd1'));

console.log('\nwebhook:');
const body = JSON.stringify({ event: 'message', payload: { id: 'A', from: '972521234567@s.whatsapp.net', chat_id: '972521234567@s.whatsapp.net', body: 'היי' } });
const gowaSign = (b, secret) => `sha256=${crypto.createHmac('sha256', secret).update(Buffer.from(b)).digest('hex')}`;
check(`★ ${C.webhook.signatureHeader}: ${C.webhook.signatureFormat} — מתקבלת`, await wa.verifyWebhookSignature(body, gowaSign(body, 's3cr3t')));
check('עברית בגוף (UTF-8) — אותם בתים כמו ב-GOWA', await wa.verifyWebhookSignature(body, gowaSign(body, 's3cr3t')) && !(await wa.verifyWebhookSignature(body, gowaSign(body.normalize('NFD') + ' ', 's3cr3t'))));
const core = codeOf('supabase/functions/_shared/wa-webhook-core.ts');
check(`★ ה-webhook קורא את הכותרת ${C.webhook.signatureHeader}`, core.includes(`req.headers.get('${C.webhook.signatureHeader.toLowerCase()}')`));
const msg = { event: 'message', device_id: 'x', session_id: 'd1', payload: Object.fromEntries(C.webhook.messagePayload.map((k) => [k, k === 'is_from_me' ? false : k === 'id' ? 'ID1' : k.startsWith('from') && k !== 'from_name' ? (k === 'from_lid' ? '1@lid' : '972521234567@s.whatsapp.net') : k === 'chat_id' ? '972521234567@s.whatsapp.net' : `v-${k}`])) };
const parsed = wa.parseWebhookEvent(msg);
check('★ מעטפת ההודעה (event / payload.id / from / body / timestamp) — מפורסרת', parsed.kind === 'message' && parsed.message.providerMsgId === 'ID1' && parsed.message.body === 'v-body' && parsed.message.receivedAt === 'v-timestamp');
check('★ אירועי מכשיר — מזוהים', C.webhook.deviceEvents.every((ev) => wa.parseWebhookEvent({ event: ev, payload: {} }).kind === 'device'));

console.log(fails === 0 ? '\nכל בדיקות החוזה מול GOWA עברו' : `\n${fails} בדיקות נכשלו`);
process.exit(fails === 0 ? 0 : 1);
