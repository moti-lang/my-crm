#!/usr/bin/env node
/**
 * ★ מיילים להורים — מקצה לקצה, בדפדפן אמיתי מול המסד המקומי.
 *
 * הקוד של הפונקציות עצמו (queueCampaign / sendTestEmail / processQueue / handleResendEvent
 * מ-_shared/email-flow.ts) רץ כאן כ-service_role, מול ספק מזויף שמתעד כל מייל. נבדק:
 *   מסך השליחה מסמן מי לא תקבל ולמה → משתנים ותצוגה מקדימה → קובץ מצורף → מייל בדיקה →
 *   שליחה (רק למי שאישרה) → התור יוצא (RTL, קישור הסרה, צרופה) → היומן → "נמסר" →
 *   הסרה מהקישור (בלי התחברות) → בשליחה הבאה היא מסומנת ולא מקבלת. וגם: לא בשבת, תקרה יומית,
 *   ובלי ספק מוגדר — לא יוצא כלום.
 *   node supabase/tests/email-ui.test.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgrestClient } from '@supabase/postgrest-js';
import { reporter, screenState, signJwt, sql, startUi } from './_ui.mjs';
import { codeOf } from './_code.mjs';

const dir = mkdtempSync(join(tmpdir(), 'email-ui-'));
const out = join(dir, 'flow.mjs');
execFileSync('npx', ['esbuild', 'supabase/functions/_shared/email-flow.ts', '--bundle', '--format=esm', `--outfile=${out}`, '--log-level=error']);
const flow = await import(out);

const OWNER = 'cccccccc-0000-0000-0000-000000000001';
const BEITAR = 'bbbbbbbb-0000-0000-0000-000000000001', MODIIN = 'bbbbbbbb-0000-0000-0000-000000000002';
const P = 'מייל בדיקה';
const CFG = { from: 'החוג של הניה <office@test.example>', replyTo: 'hania@test.example', base: 'https://crm.test', senderName: null };
const WEEKDAY = new Date('2026-10-26T09:00:00Z'), SATURDAY = new Date('2026-10-31T10:00:00Z');

const cleanup = () => sql(`
  delete from email_campaigns where id in (select campaign_id from email_messages where to_email like '%.ui@example.com') or subject like '%בדיקת מייל%';
  delete from email_suppressions where email like '%.ui@example.com';
  delete from students where full_name like '${P}%';
  update settings set value = '100'::jsonb where key = 'email_daily_cap'`);
cleanup();
const student = (suffix, branch, email, consent) => sql(`with i as (insert into students (season_id, branch_id, full_name, parent_name, email, mailing_consent, status, tuition_total)
  values ((select id from seasons where is_current), '${branch}', '${P} ${suffix}', 'הורה ${suffix}', ${email ? `'${email}'` : 'null'}, ${consent}, 'active', 1000) returning id) select id from i`);
const S = {
  A: student('א', BEITAR, 'rachel.ui@example.com', true),
  B: student('ב', BEITAR, 'Rachel.UI@example.com', true),   // אחות — אותה כתובת
  C: student('ג', BEITAR, 'leah.ui@example.com', false),     // לא אישרה תפוצה
  D: student('ד', BEITAR, null, true),                       // בלי מייל
  E: student('ה', BEITAR, 'gone.ui@example.com', true),      // הוסרה בעבר
  F: student('ו', MODIIN, 'dina.ui@example.com', true),      // סניף אחר
};
sql(`insert into email_suppressions (email, reason) values ('gone.ui@example.com', 'unsubscribe')`);

const sent = [];
const fakeSend = async (m) => { sent.push(m); return { ok: true, id: `re_${sent.length}_${Date.now()}` }; };
const noSleep = async () => {};

const { check, failed } = reporter();
const ui = await startUi();
try {
  const service = new PostgrestClient(ui.rest, { headers: { Authorization: `Bearer ${signJwt({ role: 'service_role' })}` } });
  let configured = true;
  const functions = { 'email-send': async (body) => {
    if (body.action === 'status') return { ok: true, configured, from: configured ? CFG.from : null, replyTo: CFG.replyTo, dailyCap: 100 };
    if (body.action === 'test') return flow.sendTestEmail(service, fakeSend, CFG, body);
    return { ...(await flow.queueCampaign(service, { ...body, createdBy: OWNER })), configured: true };
  } };
  const { page, log } = await ui.newPage(OWNER, { functions });
  // ★ מכונה עמוסה (כמו ב-CI): הפריים הבא מגיע רק אחרי שההקלדה כבר התחילה. "הוספת משתנה" לא
  //   יכולה לקבוע את הסמן בפריים הבא — אחרת ההקלדה שאחרי הלחיצה נכנסת לאמצע הטקסט (נפל כך ב-CI).
  await page.addInitScript(() => {
    const q = [];
    const flush = () => { while (q.length) { try { q.shift()(performance.now()); } catch { /* כמו בדפדפן */ } } };
    window.requestAnimationFrame = (cb) => { q.push(cb); setTimeout(flush, 1500); return q.length; };
    document.addEventListener('input', () => setTimeout(flush, 0), true);
  });
  page.on('dialog', (d) => void d.accept());

  console.log('\nמסך השליחה — למי:');
  await page.goto(`${ui.app}/mailing`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('חיפוש נמענות').waitFor({ timeout: 15000 });
  const s0 = await screenState(page);
  check('המסך נטען ("מיילים להורים")', s0.h1 === 'מיילים להורים' && !s0.crashed && !s0.loadError, s0.details || s0.h1);
  await page.getByLabel('סניף', { exact: true }).selectOption(BEITAR);
  await page.getByLabel('חיפוש נמענות').fill(P);
  await page.waitForTimeout(300);
  const rows = page.getByTestId('recipient-row');
  const excludedOf = async (name) => rows.filter({ hasText: `${P} ${name}` }).getAttribute('data-excluded');
  check('רק הסניף שנבחר (בלי התלמידה ממודיעין)', (await rows.count()) === 5 && (await rows.filter({ hasText: `${P} ו` }).count()) === 0);
  check('★ מי שלא אישרה תפוצה — מסומנת', (await excludedOf('ג')) === 'no_consent' && /לא אישרה תפוצה במייל/.test(await rows.filter({ hasText: `${P} ג` }).innerText()));
  check('★ בלי מייל — מסומנת', (await excludedOf('ד')) === 'no_email');
  check('★ הוסרה בעבר — מסומנת', (await excludedOf('ה')) === 'unsubscribed');
  check('★ ...ואי אפשר לבחור אותן', await rows.filter({ hasText: `${P} ג` }).getByRole('checkbox').isDisabled());
  await page.getByRole('button', { name: /בחירת כל המסוננות/ }).click();
  await page.waitForTimeout(200);
  const summary = await page.getByTestId('recipients-summary').innerText();
  check('★ בחירת כל המסוננות — רק מי שאפשר לשלוח אליה; ובלי משתנה אישי לאחיות — מייל אחד', /נבחרו 2 · יישלחו 1 מיילים · 1 אותה כתובת כבר ברשימה/.test(summary), summary);

  console.log('\nמה — משתנים, תצוגה, קובץ:');
  await page.getByLabel('נושא').fill('עדכון ל{שם התלמידה} — בדיקת מייל');
  const bodyBox = page.getByLabel('תוכן המייל');
  await bodyBox.fill('שלום ');
  await page.getByRole('button', { name: '{שם ההורה}' }).click();
  await bodyBox.press('End');
  await bodyBox.pressSequentially(',\nהיתרה של {שם התלמידה} בסניף {סניף}: {יתרה}.');
  check('כפתור המשתנה מכניס {שם ההורה}', (await bodyBox.inputValue()).startsWith('שלום {שם ההורה},'));
  const preview = await page.getByTestId('email-preview').innerText();
  check('★ תצוגה מקדימה: המשתנים בעברית מוחלפים בפרטים של התלמידה', /שלום הורה א,/.test(preview) && /היתרה של מייל בדיקה א בסניף ביתר עילית: ₪1,000\./.test(preview) && /קישור הסרה/.test(preview), preview);
  check('★ יש משתנה אישי — מייל לכל תלמידה (גם לאחיות)', (await page.getByText('כל תלמידה מקבלת מייל משלה').count()) === 1
    && /נבחרו 2 · יישלחו 2 מיילים$/.test((await page.getByTestId('recipients-summary').innerText()).trim()));
  await page.getByLabel('קובץ מצורף').setInputFiles({ name: 'מידע להורים.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 בדיקה') });
  await page.getByText(/מצורף: מידע להורים\.pdf/).waitFor({ timeout: 5000 });

  console.log('\nמייל בדיקה:');
  await page.getByLabel('כתובת לבדיקה').fill('owner.check@example.com');
  await page.getByRole('button', { name: 'מייל בדיקה' }).click();
  await page.getByText(/מייל בדיקה נשלח/).waitFor({ timeout: 10000 });
  const t = sent[0];
  check('★ מייל הבדיקה רק לכתובת שהוזנה, עם [בדיקה] ועם הקובץ', sent.length === 1 && t.to.join() === 'owner.check@example.com' && t.subject === '[בדיקה] עדכון למייל בדיקה א — בדיקת מייל'
    && t.attachments?.[0]?.filename === 'מידע להורים.pdf' && Buffer.from(t.attachments[0].content, 'base64').toString() === '%PDF-1.4 בדיקה', JSON.stringify({ to: t?.to, subject: t?.subject }));
  check('...ולא נכנס ליומן', sql(`select count(*) from email_campaigns where subject like '%בדיקת מייל%'`) === '0');

  console.log('\nשליחה:');
  await page.getByRole('button', { name: 'שליחה ל-2 הורים' }).click();
  await page.getByTestId('campaign').first().waitFor({ timeout: 10000 });
  const camp = JSON.parse(sql(`select row_to_json(c) from (select id, per_student, skipped, attachment_name, attachment_b64 is not null as has_file from email_campaigns where subject like '%בדיקת מייל%') c`));
  check('★ נכנסו לתור רק שתי האחיות (מייל לכל אחת)', sql(`select string_agg(s.full_name, ',' order by s.full_name) from email_messages m join students s on s.id = m.student_id where m.campaign_id = '${camp.id}'`) === `${P} א,${P} ב`);
  // המסך לא בחר את מי שלא תקבל — לכן השרת לא סינן איש כאן. (סינון בשרת — בהמשך, כשהמסך "מתעקש".)
  check('השרת קיבל רק את מי שאפשר לשלוח אליה', Object.values(camp.skipped).every((n) => n === 0), JSON.stringify(camp.skipped));
  check('★ כל מייל עם הפרטים שלו (נשמר כך ביומן)', sql(`select string_agg(body, ' | ' order by body) from email_messages where campaign_id = '${camp.id}'`)
    === `שלום הורה א,\nהיתרה של ${P} א בסניף ביתר עילית: ₪1,000. | שלום הורה ב,\nהיתרה של ${P} ב בסניף ביתר עילית: ₪1,000.`);
  check('הקובץ נשמר עם השליחה', camp.attachment_name === 'מידע להורים.pdf' && camp.has_file);
  check('★ היומן: 2 מיילים ממתינים', /^2 מיילים · 2 ממתינים$/.test((await page.getByTestId('campaign-counts').first().innerText()).trim()), await page.getByTestId('campaign-counts').first().innerText());

  console.log('\nהתור יוצא:');
  sent.length = 0;
  const r1 = await flow.processQueue(service, fakeSend, CFG, { now: WEEKDAY, sleep: noSleep });
  check('שני מיילים יצאו', r1.sent === 2 && sent.length === 2, JSON.stringify(r1));
  const msgs = JSON.parse(sql(`select json_agg(m order by m.created_at) from (select id, created_at, unsubscribe_token, provider_id, status from email_messages where campaign_id = '${camp.id}') m`));
  const m0 = sent.find((x) => x.idempotencyKey === msgs[0].id);
  check('★ מהכתובת של החוג, עם כתובת לתשובות', sent.every((x) => x.from === CFG.from && x.replyTo === CFG.replyTo));
  check('★ RTL, וקישור הסרה אישי בכל מייל (ב-HTML, בטקסט ובכותרת List-Unsubscribe)', Boolean(m0) && /dir="rtl"/.test(m0.html)
    && m0.html.includes(`https://crm.test/unsubscribe/${msgs[0].unsubscribe_token}`) && m0.text.includes(`/unsubscribe/${msgs[0].unsubscribe_token}`)
    && m0.headers['List-Unsubscribe'] === `<https://crm.test/unsubscribe/${msgs[0].unsubscribe_token}>`);
  check('★ הקובץ מצורף לכל מייל', sent.every((x) => x.attachments?.[0]?.filename === 'מידע להורים.pdf'));
  check('מפתח אידמפוטנטיות = מזהה ההודעה (ניסיון חוזר לא שולח פעמיים)', sent.every((x) => msgs.some((m) => m.id === x.idempotencyKey)));
  check('בתוך היומן: "נשלח" עם מזהה הספק', msgs.every((m) => m.status === 'sent' && m.provider_id?.startsWith('re_')));
  check('הצרופה נמחקה מהמסד כשהכל יצא', sql(`select attachment_b64 is null from email_campaigns where id = '${camp.id}'`) === 't'
    || (await flow.processQueue(service, fakeSend, CFG, { now: WEEKDAY, sleep: noSleep }), sql(`select attachment_b64 is null from email_campaigns where id = '${camp.id}'`) === 't'));

  console.log('\nהיומן ומצב המסירה:');
  await flow.handleResendEvent(service, { type: 'email.delivered', data: { email_id: msgs[0].provider_id } });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'יומן שליחות' }).click();
  const card = page.getByTestId('campaign').filter({ hasText: 'בדיקת מייל' });
  await card.waitFor({ timeout: 10000 });
  check('★ היומן: נמסר / נשלח', /2 מיילים · 1 נמסרו · 1 נשלחו/.test(await card.getByTestId('campaign-counts').innerText()), await card.getByTestId('campaign-counts').innerText());
  await card.getByRole('button', { name: /בדיקת מייל/ }).click();
  await card.getByTestId('email-message').first().waitFor({ timeout: 8000 });
  const statuses = await card.getByTestId('email-message').evaluateAll((els) => els.map((e) => e.getAttribute('data-status')).sort().join(','));
  check('★ לכל מייל: למי, ומצב (נמסר / נשלח)', statuses === 'delivered,sent' && /rachel\.ui@example\.com/.test(await card.innerText()) && /נמסר/.test(await card.innerText()));
  await card.getByRole('button', { name: 'מה נשלח' }).first().click();
  check('"מה נשלח" — הנושא והתוכן בדיוק כפי שיצאו', /עדכון למייל בדיקה [אב] — בדיקת מייל/.test(await card.innerText()) && /היתרה של מייל בדיקה/.test(await card.innerText()));

  console.log('\nהסרה מהתפוצה — מהקישור שבמייל, בלי התחברות:');
  const guest = await ui.newPage(null);
  await guest.page.goto(`${ui.app}/unsubscribe/${msgs[0].unsubscribe_token}`, { waitUntil: 'domcontentloaded' });
  await guest.page.getByRole('button', { name: 'כן, להסיר אותי' }).waitFor({ timeout: 15000 });
  check('הדף מציג את הכתובת, מוסתרת חלקית — ולא מסיר בפתיחה', /r\*\*\*@example\.com/.test(await guest.page.locator('main').innerText())
    && sql(`select count(*) from email_suppressions where email = 'rachel.ui@example.com'`) === '0');
  await guest.page.getByRole('button', { name: 'כן, להסיר אותי' }).click();
  await guest.page.getByText(/הוסרה מרשימת התפוצה/).waitFor({ timeout: 10000 });
  check('★ הוסרה: הכתובת חסומה, וההסכמה בוטלה לשתי האחיות', sql(`select count(*) from email_suppressions where email = 'rachel.ui@example.com'`) === '1'
    && sql(`select bool_and(not mailing_consent) from students where id in ('${S.A}', '${S.B}')`) === 't');
  await guest.page.goto(`${ui.app}/unsubscribe/${'0'.repeat(36)}`, { waitUntil: 'domcontentloaded' });
  check('קישור לא תקף — הודעה ברורה', await guest.page.getByText('הקישור לא תקף').waitFor({ timeout: 10000 }).then(() => true, () => false));

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByLabel('חיפוש נמענות').waitFor({ timeout: 15000 });
  await page.getByLabel('סניף', { exact: true }).selectOption(BEITAR);
  await page.getByLabel('חיפוש נמענות').fill(P);
  await page.waitForTimeout(400);
  check('★ בשליחה הבאה: מי שהסירה את עצמה מסומנת ולא ניתנת לבחירה', Boolean(await excludedOf('א')) && Boolean(await excludedOf('ב'))
    && await rows.filter({ hasText: `${P} א` }).getByRole('checkbox').isDisabled());
  const again = await flow.queueCampaign(service, { studentIds: [S.A, S.B, S.F], subject: 'שוב בדיקת מייל', body: 'שלום {שם ההורה}', createdBy: OWNER });
  check('★ וגם אם המסך היה שולח אותה — השרת מסנן (רק דינה ממודיעין)', again.ok && again.queued === 1 && again.skipped.no_consent === 2, JSON.stringify(again));

  console.log('\nשבת, תקרה יומית, ספק לא מוגדר:');
  sent.length = 0;
  const sat = await flow.processQueue(service, fakeSend, CFG, { now: SATURDAY, sleep: noSleep });
  check('★ בשבת — לא יוצא כלום (נשאר בתור)', sat.blocked === 'shabbat_or_holiday' && sent.length === 0 && sql(`select status from email_messages where campaign_id = '${again.campaignId}'`) === 'queued');
  const off = await flow.processQueue(service, fakeSend, { ...CFG, from: null }, { now: WEEKDAY, sleep: noSleep });
  check('★ בלי ספק מוגדר — לא יוצא כלום', off.configured === false && sent.length === 0);
  const usedToday = Number(sql(`select count(*) from email_messages where sending_at >= (date_trunc('day', now() at time zone 'Asia/Jerusalem')) at time zone 'Asia/Jerusalem'`));
  sql(`update settings set value = '${usedToday}'::jsonb where key = 'email_daily_cap'`);
  const capped = await flow.processQueue(service, fakeSend, CFG, { now: WEEKDAY, sleep: noSleep });
  check('★ התקרה היומית מוצתה — לא יוצא, נשאר בתור למחר', capped.claimed === 0 && sent.length === 0, JSON.stringify(capped));
  sql(`update settings set value = '100'::jsonb where key = 'email_daily_cap'`);
  const ok2 = await flow.processQueue(service, fakeSend, CFG, { now: WEEKDAY, sleep: noSleep });
  check('ביום חול, בתוך התקרה — יוצא', ok2.sent === 1 && sent[0]?.to.join() === 'dina.ui@example.com');
  const idx = codeOf('supabase/functions/email-send/index.ts');
  const ownerAt = idx.search(/rpc\('auth_role'\);\s*\n\s*if \(role !== 'owner'\) return json\(/);
  check('★ email-send: בעלים בלבד — לפני כל שליחה או תור', ownerAt !== -1 && ownerAt < idx.indexOf('sendTestEmail(') && ownerAt < idx.indexOf('queueCampaign('));
  check('★ בשרת: בלי ספק מוגדר לא מכניסים לתור (שלא ייצא בהפתעה כשיוגדר)', /if \(!cfg\.from\) return json\(/.test(idx) && idx.indexOf('if (!cfg.from) return json(') < idx.indexOf('queueCampaign('));

  configured = false;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByLabel('חיפוש נמענות').waitFor({ timeout: 15000 });
  check('ספק לא מוגדר — המסך אומר זאת, וכפתורי השליחה כבויים', await page.getByText(/שליחת המיילים עוד לא חוברה/).waitFor({ timeout: 8000 }).then(() => true, () => false)
    && await page.getByRole('button', { name: /^שליחה ל-/ }).isDisabled());

  check('בלי שאילתות שנדחו ובלי שגיאות JS', log.badResponses.length === 0 && log.pageErrors.length === 0 && guest.log.pageErrors.length === 0,
    [...log.badResponses, ...log.pageErrors, ...guest.log.pageErrors].join('\n'));
} finally {
  await ui.stop();
  cleanup();
}
console.log(failed() === 0 ? '\nמיילים להורים — כל הבדיקות עברו' : `\n${failed()} בדיקות נכשלו`);
process.exit(failed() ? 1 : 0);
