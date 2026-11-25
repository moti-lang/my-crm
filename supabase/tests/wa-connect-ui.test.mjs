#!/usr/bin/env node
/**
 * ★ מסך "חיבור וואטסאפ" (הגדרות, בעלים) — בדפדפן אמיתי, עם wa-admin מזויפת (ה-Edge Function עצמה
 *   נבדקת ב-wa-gowa.test.mjs):
 *   · לא מוגדר — "וואטסאפ לא מוגדר", בלי שגיאה ובלי קריסה.
 *   · מצב בדיקה (מספר בדיקה) / מצב צפייה — מוצג מה באמת יוצא.
 *   · QR: "חיבור מספר" → התמונה מוצגת → אחרי הסריקה "מחובר" והקוד נעלם.
 *   · קצב השליחה נשמר בהגדרות (wa_pacing), עם בדיקת טווח.
 *   node supabase/tests/wa-connect-ui.test.mjs
 */
import { reporter, sql, startUi } from './_ui.mjs';

const OWNER = 'cccccccc-0000-0000-0000-000000000001';
const PACING = sql(`select value::text from settings where key = 'wa_pacing'`);
const restore = () => sql(`update settings set value = '${PACING}'::jsonb where key = 'wa_pacing'`);
const QR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const { check, failed } = reporter();
const ui = await startUi();
const open = async (functions) => {
  const { page, log } = await ui.newPage(OWNER, { functions });
  page.on('dialog', (d) => void d.accept());
  await page.goto(`${ui.app}/settings`);
  return { page, log };
};
try {
  console.log('\nלא מוגדר:');
  {
    const { page, log } = await open({ 'wa-admin': () => ({ ok: true, configured: false, mode: { dryRun: true, testPhoneTail: null } }) });
    const box = page.getByTestId('wa-not-configured');
    await box.waitFor({ timeout: 8000 });
    const t = (await box.textContent()) ?? '';
    check('★ "וואטסאפ לא מוגדר" — בלי שגיאה', t.includes('וואטסאפ לא מוגדר') && (await page.getByRole('alert').count()) === 0, t);
    check('מצב צפייה: "שום דבר לא נשלח"', ((await page.getByTestId('wa-mode').textContent()) ?? '').includes('שום דבר לא נשלח'));
    check('אין כפתור QR כשאין שרת', (await page.getByRole('button', { name: /QR/ }).count()) === 0);
    // ★ קצב השליחה — נשמר בהגדרות.
    const pace = page.getByTestId('wa-pacing');
    await pace.getByLabel('מרווח מינימלי (שניות)').fill('12');
    await pace.getByLabel('מרווח מקסימלי (שניות)').fill('5');
    check('★ מקסימום קטן ממינימום — שגיאה, ואי אפשר לשמור', (await pace.getByRole('alert').count()) === 1 && await pace.getByRole('button', { name: 'שמירת הקצב' }).isDisabled());
    await pace.getByLabel('מרווח מקסימלי (שניות)').fill('30');
    await pace.getByLabel('עד הודעות בדקה').fill('3');
    await pace.getByRole('button', { name: 'שמירת הקצב' }).click();
    await pace.getByRole('status').waitFor({ timeout: 8000 });
    const saved = JSON.parse(sql(`select value::text from settings where key = 'wa_pacing'`));
    check('★ נשמר בהגדרות: 12–30 שניות, 3 בדקה (וזמן הסבב נשאר)', saved.min_gap_seconds === 12 && saved.max_gap_seconds === 30 && saved.max_per_minute === 3 && saved.run_budget_seconds === 110, JSON.stringify(saved));
    check('בלי שגיאות דף ובלי שאילתות שבורות', log.pageErrors.length === 0 && log.badResponses.length === 0, [...log.pageErrors, ...log.badResponses].join('\n'));
    await page.close();
    restore();
  }

  console.log('\nחיבור מספר (QR), במצב בדיקה:');
  {
    let state = 'logged_out';
    const base = () => ({ ok: true, configured: true, host: 'wa-teichtal.example.test', mode: { dryRun: true, testPhoneTail: '2233' } });
    const { page, log } = await open({
      'wa-admin': (body) => {
        if (body.action === 'connect') return { ...base(), state: 'qr', qrDataUrl: QR, qrSeconds: 30 };
        return { ...base(), state, phone: state === 'connected' ? '972501112233' : null };
      },
    });
    await page.getByTestId('wa-state').waitFor({ timeout: 8000 });
    check('★ מצב בדיקה: "רק למספר הבדיקה" (4 ספרות אחרונות בלבד)', ((await page.getByTestId('wa-mode').textContent()) ?? '').includes('רק למספר הבדיקה') && ((await page.getByTestId('wa-mode').textContent()) ?? '').includes('2233'));
    check('לא מחובר — "צריך לסרוק QR"', ((await page.getByTestId('wa-state').textContent()) ?? '').includes('צריך לסרוק QR'));
    await page.getByRole('button', { name: 'חיבור מספר (QR)' }).click();
    const img = page.getByRole('img', { name: 'קוד QR לחיבור וואטסאפ' });
    await img.waitFor({ timeout: 8000 });
    check('★ תמונת ה-QR מוצגת (מ-wa-admin, כתמונה)', (await img.getAttribute('src')) === QR);
    check('משך התוקף מוצג', ((await page.getByTestId('wa-qr').textContent()) ?? '').includes('30 שניות'));
    state = 'connected';   // הטלפון סרק
    await page.getByText('מחובר · 972501112233').waitFor({ timeout: 10000 });
    check('★ אחרי הסריקה — "מחובר", והקוד נעלם', (await img.count()) === 0);
    check('כפתור ניתוק — רק כשמחובר', (await page.getByRole('button', { name: 'ניתוק המספר' }).count()) === 1 && (await page.getByRole('button', { name: /QR/ }).count()) === 0);
    check('בלי שגיאות דף', log.pageErrors.length === 0, log.pageErrors.join('\n'));
    await page.close();
  }

  console.log('\nהשרת לא עונה:');
  {
    const { page } = await open({ 'wa-admin': () => ({ ok: false, configured: true, error: 'GOWA לא עונה: ECONNREFUSED' }) });
    const a = page.getByRole('alert').filter({ hasText: 'GOWA לא עונה' });
    await a.waitFor({ timeout: 8000 });
    check('★ הודעת השגיאה מוצגת, ויש "בדיקה חוזרת"', (await page.getByRole('button', { name: 'בדיקה חוזרת' }).count()) === 1);
    await page.close();
  }
} finally {
  await ui.stop();
  restore();
}
console.log(failed() === 0 ? '\nמסך חיבור וואטסאפ (דפדפן): הכל עבר' : `\n${failed()} בדיקות נכשלו`);
process.exit(failed() === 0 ? 0 : 1);
