#!/usr/bin/env node
/**
 * בדיקת וואטסאפ חיה, מול המערכת בענן (לא ישירות מול GOWA — הסיסמה שלה רק בסודות של ה-Edge Functions).
 *
 *   1. בריאות: cron-wa-health → GOWA עונה, והמספר מחובר.
 *   2. (רק עם --send) הודעת בדיקה אחת דרך wa-send — השער האמיתי של המערכת — למספר הבדיקה.
 *      ★ השרת שולח באמת רק ל-WA_TEST_PHONE שמוגדר בסודות שלו. אם ההודעה חזרה "הרצה יבשה" —
 *        המספר כאן שונה מזה שבשרת, ושום דבר לא יצא. להורים לא יוצא כלום בשום מקרה.
 *
 *   CRON_SECRET=… SUPABASE_URL=… WA_TEST_PHONE=05… node scripts/verify-whatsapp.mjs [--send]
 */
const { SUPABASE_URL, CRON_SECRET, WA_TEST_PHONE } = process.env;
for (const [k, v] of Object.entries({ SUPABASE_URL, CRON_SECRET })) {
  if (!v) { console.error(`✗ חסר ${k}`); process.exit(2); }
}
const SEND = process.argv.includes('--send');
if (SEND && !WA_TEST_PHONE) { console.error('✗ --send דורש WA_TEST_PHONE (אותו מספר כמו בסודות של השרת)'); process.exit(2); }

let fails = 0;
const check = (label, ok, detail = '') => {
  if (!ok) fails++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
};
const fn = (name, body) => fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/${name}`, {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${CRON_SECRET}` }, body: JSON.stringify(body ?? {}),
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

console.log('\nבריאות:');
const h = await fn('cron-wa-health');
check(`cron-wa-health עונה (${h.status})`, h.status === 200);
check('★ GOWA מוגדרת, עונה, והמספר מחובר', h.body.ok === true && h.body.state === 'connected', JSON.stringify(h.body));

if (SEND) {
  console.log('\n★ הודעת בדיקה למספר הבדיקה:');
  const s = await fn('wa-send', { to: WA_TEST_PHONE, body: 'בדיקת חיבור ממערכת הניהול של החוג (GOWA). אין צורך להשיב.' });
  check('wa-send: נשלחה', s.body.sent === true, JSON.stringify(s.body));
  check('★ נשלחה באמת (לא הרצה יבשה)', s.body.sent === true && s.body.dry_run === false,
        'הרצה יבשה: WA_TEST_PHONE כאן שונה מזה שבסודות של השרת, או שהוא לא מוגדר שם');
  check('יש מזהה הודעה מ-GOWA', Boolean(s.body.provider_msg_id));
  console.log('\n  → לוודא בטלפון שההודעה הגיעה, ולענות עליה — התשובה צריכה להופיע במסך השיחות (webhook).');
}

console.log(fails === 0 ? '\nוואטסאפ: הכל עבר' : `\n${fails} בדיקות נכשלו`);
process.exit(fails === 0 ? 0 : 1);
