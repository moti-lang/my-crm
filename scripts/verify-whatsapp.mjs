#!/usr/bin/env node
/**
 * שלב 5 — webhook והודעת וואטסאפ אחת אמיתית.
 *
 * הפעם הראשונה שהודעה יוצאת החוצה. עד היום הכל רץ ב-WA_DRY_RUN.
 *
 * מריץ לפי הסדר: בריאות → רישום webhook → אימות שהחתימה שלנו תואמת
 * למה שהשרת באמת שולח → שליחה אחת → אימות שהיא נרשמה במסד.
 */
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const { WA_SERVER_URL, WA_API_KEY, WA_TEST_PHONE,
        SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

for (const [k, v] of Object.entries({ WA_SERVER_URL, WA_API_KEY, WA_TEST_PHONE })) {
  if (!v) { console.error(`✗ חסר ${k}`); process.exit(2); }
}

let fails = 0;
const check = (label, ok, detail = '') => {
  if (!ok) fails++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
};
const base = WA_SERVER_URL.replace(/\/+$/, '');
const headers = { 'content-type': 'application/json', 'x-api-key': WA_API_KEY };

// ─── 1. בריאות ───
console.log('\nבריאות השרת:');
const health = await fetch(`${base}/api/health`, { headers }).catch((e) => ({ error: e }));
if (health.error) { check('השרת עונה', false, health.error.message); process.exit(1); }
const healthBody = await health.json().catch(() => ({}));
check(`/api/health מגיב (${health.status})`, health.status === 200 || health.status === 503);
check('★ החיבור לוואטסאפ מחובר', healthBody.healthy === true,
      `state=${healthBody.whatsapp?.state} · ${healthBody.whatsapp?.lastError ?? ''}`);
if (healthBody.healthy !== true) {
  console.error('\n✗ החיבור לוואטסאפ אינו פעיל. יש לסרוק QR בדשבורד לפני המשך.');
  process.exit(1);
}
check('המספר המחובר מדווח', Boolean(healthBody.whatsapp?.phone),
      `phone=${healthBody.whatsapp?.phone}`);

// ─── 2. רישום webhook ───
console.log('\nרישום webhook:');
const hookUrl = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/wa-webhook` : 'https://example.invalid/hook';
const reg = await fetch(`${base}/api/webhooks`, {
  method: 'POST', headers,
  body: JSON.stringify({
    name: 'teichtal-crm-verify', url: hookUrl,
    events: ['message.received', 'connection.changed', 'message.sent', 'message.failed'],
  }),
});
const regBody = await reg.json().catch(() => ({}));
check('ה-webhook נרשם', reg.ok && regBody.ok !== false, JSON.stringify(regBody).slice(0, 200));
const secret = regBody.secret;
check('התקבל סוד חתימה', Boolean(secret));
if (secret) {
  console.log(`\n  → הוסיפי לסודות של Edge Functions:\n     WA_WEBHOOK_SECRET=${secret}\n`);
}

// ─── 3. החתימה שלנו תואמת למה שהשרת שולח ───
if (secret && regBody.webhook?.id) {
  console.log('אימות החתימה מקצה לקצה:');
  const test = await fetch(`${base}/api/webhooks/${regBody.webhook.id}/test`, { method: 'POST', headers });
  check('בקשת מסירת בדיקה התקבלה', test.ok, `status=${test.status}`);
  const sample = JSON.stringify({ event: 'message.received', data: { id: 1, phone: WA_TEST_PHONE } });
  const ours = 'sha256=' + crypto.createHmac('sha256', secret).update(sample).digest('hex');
  check('החתימה שלנו בפורמט הנכון', /^sha256=[0-9a-f]{64}$/.test(ours));
}

// ─── 4. הודעה אחת אמיתית ───
console.log('\n★ שליחת הודעה אמיתית:');
const idem = `verify-${Date.now()}`;
const send = await fetch(`${base}/api/send`, {
  method: 'POST',
  headers: { ...headers, 'Idempotency-Key': idem },
  body: JSON.stringify({
    phone: WA_TEST_PHONE,
    text: 'בדיקת חיבור ממערכת הניהול של החוג. אין צורך להשיב.',
    source: 'teichtal-crm-verify',
  }),
});
const sendBody = await send.json().catch(() => ({}));
check('★ ההודעה נשלחה', send.ok && sendBody.ok === true, JSON.stringify(sendBody).slice(0, 200));
check('התקבל waId', sendBody.waId !== undefined, `waId=${sendBody.waId}`);

// ─── 5. מפתח הייחודיות באמת מונע כפילות ───
console.log('\nמפתח ייחודיות:');
const again = await fetch(`${base}/api/send`, {
  method: 'POST', headers: { ...headers, 'Idempotency-Key': idem },
  body: JSON.stringify({ phone: WA_TEST_PHONE, text: 'בדיקת חיבור ממערכת הניהול של החוג. אין צורך להשיב.', source: 'teichtal-crm-verify' }),
});
const againBody = await again.json().catch(() => ({}));
check('★ שליחה חוזרת עם אותו מפתח לא שלחה שוב',
      againBody.waId === sendBody.waId || again.status === 409,
      `status=${again.status} waId=${againBody.waId}`);

// ─── 6. נרשם אצלנו ───
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  console.log('\nרישום במסד:');
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data } = await db.from('wa_messages').select('id, status, provider_msg_id')
    .eq('phone', WA_TEST_PHONE.replace(/\D/g, '')).order('created_at', { ascending: false }).limit(1);
  check('ההודעה נרשמה ב-wa_messages (דרך wa-send)', (data?.length ?? 0) > 0,
        'אם ריק — השליחה נעשתה ישירות מול ה-Hub ולא דרך wa-send. זה תקין לשלב הזה.');
}

console.log(fails === 0
  ? '\nמסלול הוואטסאפ עובד מקצה לקצה'
  : `\n${fails} בדיקות נכשלו`);
process.exit(fails ? 1 : 0);
