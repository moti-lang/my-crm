#!/usr/bin/env node
/**
 * ★ מיילים להורים — הלוגיקה הטהורה, וההתאמה בין המסך לשרת.
 *   · מי מקבלת ולמה לא (הסכמה, כתובת, הסרה), ואחיות — מייל אחד כשאין משתנים אישיים.
 *   · המייל: עברית מימין לשמאל, תוכן מנוטרל (אין HTML מוזרק), וקישור הסרה — תמיד.
 *   · חתימת Resend (Svix): נכונה עוברת; גוף שהשתנה, סוד אחר או אירוע ישן — נדחים.
 *   · המסך מסמן בדיוק כמו שהשרת מחליט (שני עותקים — כמו template-parity).
 *   node supabase/tests/email-core.test.mjs
 */
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'email-core-'));
const bundle = (src, name, extra = []) => {
  const out = join(dir, name);
  execFileSync('npx', ['esbuild', src, '--bundle', '--format=esm', `--outfile=${out}`, '--log-level=error', '--alias:@=./src', ...extra]);
  return out;
};
const core = await import(bundle('supabase/functions/_shared/email-core.ts', 'core.mjs'));
const front = await import(bundle('src/lib/emailRecipients.ts', 'front.mjs'));

let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`); };

console.log('\nמי מקבלת:');
const R = (id, email, consent, extra = {}) => ({ id, full_name: `תלמידה ${id}`, parent_name: `הורה ${id}`, email, branch_name: 'ביתר', balance: 100, paid: 0, due: 100, mailing_consent: consent, ...extra });
const rows = [R('1', 'Rachel@Example.com', true), R('2', ' rachel@example.com ', true), R('3', 'leah@example.com', false), R('4', null, true), R('5', 'not-an-email', true), R('6', 'gone@example.com', true), R('7', 'dina@example.com', null)];
const sup = new Set(['gone@example.com']);
{
  const { send, skipped } = core.selectRecipients(rows, sup, true);
  check('★ אישית: כל אחת מהאחיות מקבלת מייל משלה', send.map((r) => r.id).join(',') === '1,2' && send[0].to === 'rachel@example.com');
  check('★ בלי הסכמה (false וגם לא סומן) — לא מקבלת', skipped.no_consent.map((r) => r.id).join(',') === '3,7');
  check('בלי כתובת או כתובת שבורה — לא מקבלת', skipped.no_email.map((r) => r.id).join(',') === '4,5');
  check('★ הוסרה מהתפוצה — לא מקבלת', skipped.unsubscribed.map((r) => r.id).join(',') === '6');
}
{
  const { send, skipped } = core.selectRecipients(rows, sup, false);
  check('★ לא אישית: אחיות — מייל אחד לכתובת', send.map((r) => r.id).join(',') === '1' && skipped.duplicate.map((r) => r.id).join(',') === '2');
}
check('משתנה אישי בעברית או באנגלית', core.isPersonal('שלום', '{שם התלמידה}') && core.isPersonal('{balance}') && core.isPersonal('יתרה: {יתרה}')
  && !core.isPersonal('שלום {שם ההורה}, מחר אין חוג בסניף {סניף}'));

console.log('\nהמסך מסמן כמו שהשרת מחליט:');
{
  const supMap = new Map([['gone@example.com', 'unsubscribe']]);
  const server = core.selectRecipients(rows, sup, true);
  const reasonOf = (id) => Object.entries(server.skipped).find(([, list]) => list.some((r) => r.id === id))?.[0] ?? null;
  const bad = rows.filter((r) => front.exclusionOf(r, supMap) !== reasonOf(r.id)).map((r) => `${r.id}: מסך=${front.exclusionOf(r, supMap)} שרת=${reasonOf(r.id)}`);
  check('★ סיבת אי-השליחה זהה לכל תלמידה', bad.length === 0, bad.join(' · '));
  const texts = ['{שם התלמידה}', '{balance}', 'שלום {שם ההורה}', '{סניף} {תאריך}', '{paid}', '{סכום כולל}', ''];
  check('★ "אישי או לא" זהה', texts.every((t) => core.isPersonal(t) === front.isPersonal(t)));
  check('תוויות הסיבות זהות', JSON.stringify(core.SKIP_LABEL) === JSON.stringify(front.SKIP_LABEL));
}

console.log('\nהמייל:');
{
  const vars = core.varsFor(R('1', 'a@b.co', true, { balance: 1300, full_name: 'שירה', parent_name: 'רחלי', branch_name: 'ביתר עילית' }), new Date('2026-10-25T10:00:00Z'));
  check('משתנים: שם, סניף, יתרה בשקלים, תאריך', vars.parent_name === 'רחלי' && vars.student_name === 'שירה' && vars.branch === 'ביתר עילית' && vars.balance === '₪1,300' && vars.date === '25/10/2026');
  check('★ נושא: שורה אחת (שבירת שורה בנושא = הזרקת כותרות)', core.renderSubject('שלום {שם ההורה}\r\nBcc: x@evil.com', vars) === 'שלום רחלי Bcc: x@evil.com');
  const url = core.unsubscribeUrl('https://crm.example/', 'a'.repeat(36));
  check('קישור ההסרה', url === `https://crm.example/unsubscribe/${'a'.repeat(36)}`);
  const { html, text } = core.buildEmail({ body: 'שלום רחלי,\n<script>alert(1)</script>\nפרטים: https://example.com/a?b=1&c=2.', unsubscribeUrl: url });
  check('★ עברית מימין לשמאל', /<html lang="he" dir="rtl">/.test(html) && /dir="rtl"/.test(html.slice(html.indexOf('<body'))));
  check('★ תוכן מנוטרל: אין <script> אמיתי', !html.includes('<script>') && html.includes('&lt;script&gt;'));
  check('קישור בתוכן לחיץ, בלי הנקודה שבסוף המשפט', html.includes('<a href="https://example.com/a?b=1&amp;c=2" '));
  check('★ קישור הסרה ב-HTML ובטקסט, תמיד', html.includes(`href="${url}"`) && html.includes('להסרה מרשימת התפוצה') && text.includes(url));
  check('שורות כמו שנכתבו', html.includes('שלום רחלי,<br>'));
}

console.log('\nחתימת Resend (Svix):');
{
  const secretBytes = Buffer.from('test-secret-for-resend-webhooks!');
  const secret = `whsec_${secretBytes.toString('base64')}`;
  const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'abc' } });
  const now = 1_800_000_000;
  const sign = (id, ts, b, key = secretBytes) => `v1,${createHmac('sha256', key).update(`${id}.${ts}.${b}`).digest('base64')}`;
  const h = (sig, ts = String(now)) => ({ id: 'msg_1', timestamp: ts, signature: sig });
  check('★ חתימה נכונה — עוברת', await core.verifyResendSignature(secret, h(sign('msg_1', now, body)), body, now));
  check('כמה חתימות (סבב מפתחות) — אחת נכונה מספיקה', await core.verifyResendSignature(secret, h(`v1,AAAA ${sign('msg_1', now, body)}`), body, now));
  check('★ גוף שהשתנה — נדחה', !(await core.verifyResendSignature(secret, h(sign('msg_1', now, body)), body.replace('delivered', 'bounced'), now)));
  check('★ סוד אחר — נדחה', !(await core.verifyResendSignature(secret, h(sign('msg_1', now, body, Buffer.from('other'))), body, now)));
  check('★ אירוע ישן (10 דקות) — נדחה', !(await core.verifyResendSignature(secret, h(sign('msg_1', now - 600, body), String(now - 600)), body, now)));
  check('בלי חתימה / בלי סוד — נדחה', !(await core.verifyResendSignature(secret, h(null), body, now)) && !(await core.verifyResendSignature('', h(sign('msg_1', now, body)), body, now)));
}

console.log(fails === 0 ? '\nליבת המיילים — כל הבדיקות עברו' : `\n${fails} בדיקות נכשלו`);
process.exit(fails ? 1 : 0);
