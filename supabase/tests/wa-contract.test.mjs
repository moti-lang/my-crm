#!/usr/bin/env node
/**
 * בדיקת חוזה מול whatsapp-hub.
 *
 * מאמת שחתימת ה-HMAC שלנו זהה בדיוק ל-sign() בקוד השרת
 * (src/store/webhooks.ts): 'sha256=' + HMAC-SHA256(body, secret) בהקסה.
 * זו נקודת האינטגרציה שהכי קל לשבור בלי לשים לב — Node crypto מול
 * WebCrypto, קידוד UTF-8, וגוף גולמי מול JSON שעבר סריאליזציה מחדש.
 *
 * הרצה:  npm run test:wa
 */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SECRET = 'test-secret-abc123';
process.env.WA_WEBHOOK_SECRET = SECRET;

// חבילה את wa.ts עם Deno.env ממופה ל-process.env
const out = join(mkdtempSync(join(tmpdir(), 'wa-')), 'wa.mjs');
execFileSync('npx', ['esbuild', 'supabase/functions/_shared/wa.ts', '--bundle', '--format=esm',
  `--outfile=${out}`, '--log-level=error', '--define:Deno.env.get=__denoEnvGet',
  '--banner:js=const __denoEnvGet = (k) => process.env[k];'], { stdio: 'inherit' });

const { verifyHubSignature, parseHubEvent } = await import(out);

/** זהה ל-sign() בשרת */
const serverSign = (payload, secret) =>
  'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');

let fails = 0;
const check = (label, ok) => { if (!ok) fails++; console.log(`  ${ok ? '✓' : '✗'} ${label}`); };

// מבנה message.received האמיתי מ-src/wa/client.ts
const body = JSON.stringify({
  event: 'message.received', timestamp: '2026-09-02T10:00:00.000Z',
  data: { id: 4471, phone: '972521000001', display: '052-100-0001', name: 'רחלי כהן',
          type: 'text', text: 'שילמתי 860 תלבושות בביתר', fileName: null, mediaPath: null,
          mediaUrl: null, waId: '3EB0ABC', receivedAt: '2026-09-02T10:00:00.000Z' } });

const good = serverSign(body, SECRET);
check('חתימה תקינה מהשרת מתקבלת',        await verifyHubSignature(body, good));
check('חתימה בסוד שגוי נדחית',            !(await verifyHubSignature(body, serverSign(body, 'wrong'))));
check('גוף ששונה אחרי החתימה נדחה',       !(await verifyHubSignature(body + ' ', good)));
check('חתימה חסרה נדחית',                 !(await verifyHubSignature(body, null)));
check('חתימה ריקה נדחית',                 !(await verifyHubSignature(body, '')));
check('חתימה באורך שגוי נדחית',           !(await verifyHubSignature(body, 'sha256=abc')));

const heb = JSON.stringify({ event: 'message.received',
  data: { id: 1, phone: '972521000001', text: 'שלום, כמה עולה החוג? 🌸' } });
check('גוף עם עברית ואימוג׳י מאומת נכון',  await verifyHubSignature(heb, serverSign(heb, SECRET)));

const m = parseHubEvent(JSON.parse(body));
check('מחלץ מזהה הודעה',                  m?.providerMsgId === '4471');
check('מחלץ טלפון',                       m?.from === '972521000001');
check('מחלץ טקסט',                        m?.body === 'שילמתי 860 תלבושות בביתר');
check('מחלץ שם איש קשר',                  m?.contactName === 'רחלי כהן');
check('★ אירוע בלי מזהה מוחזר null',      parseHubEvent({ data: { phone: '972521000001', text: 'x' } }) === null);
check('★ אירוע בלי טלפון מוחזר null',     parseHubEvent({ data: { id: 7, text: 'x' } }) === null);
check('★ payload ריק מוחזר null',         parseHubEvent(null) === null);
check('id=0 אינו נחשב חסר',               parseHubEvent({ data: { id: 0, phone: '972521000001', text: 'x' } })?.providerMsgId === '0');

console.log(fails === 0 ? '\nכל בדיקות החוזה מול whatsapp-hub עברו' : `\n${fails} בדיקות נכשלו`);
process.exit(fails ? 1 : 0);
