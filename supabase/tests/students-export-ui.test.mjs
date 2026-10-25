#!/usr/bin/env node
/**
 * ★ ייצוא תלמידות לאקסל: מייצאים מהמסך האמיתי, קוראים את הקובץ שירד, ומשווים תא-תא.
 *
 * דפדפן אמיתי + PostgREST אמיתי מול המסד המקומי. הערכים הצפויים מחושבים כאן בנפרד,
 * ישירות מהמסד (SQL) — לא מאותו קוד שמייצא — כך שטעות בייצוא לא "מסכימה עם עצמה".
 *   · הייצוא מכבד את הסינון שעל המסך (חיפוש + "חייבות"), ובאותו סדר.
 *   · עברית תקינה, מספרים נשארים מספרים, תאריכים dd/MM/yyyy.
 *   · מנהלת סניף — רק הסניף שלה. רואת חשבון — בלי טלפונים, כתובת ומייל.
 *   · מסך הסניף מייצא את כל תלמידות הסניף. המייל בכרטיס ובטבלה, וחיפוש לפיו.
 *   node supabase/tests/students-export-ui.test.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reporter, screenState, sql, startUi } from './_ui.mjs';

const dir = mkdtempSync(join(tmpdir(), 'stu-export-'));
const out = join(dir, 'export-core.cjs');
execFileSync('npx', ['esbuild', 'src/lib/export-core.ts', '--bundle', '--format=cjs', '--platform=node', `--outfile=${out}`, '--log-level=error', '--alias:@=./src']);
const coreMod = await import(out);
const core = coreMod.default ?? coreMod;

const USERS = { owner: 'cccccccc-0000-0000-0000-000000000001', branch_manager: 'cccccccc-0000-0000-0000-000000000002', accountant: 'cccccccc-0000-0000-0000-000000000003' };
const BEITAR = 'bbbbbbbb-0000-0000-0000-000000000001', MODIIN = 'bbbbbbbb-0000-0000-0000-000000000002';
const PREFIX = 'ייצוא בדיקה';

// הכותרות שהלקוחה ביקשה, בסדר הזה. (נכתבות כאן ולא נלקחות מהקוד שמייצא.)
const HEADERS = ['שם מלא', 'תאריך לידה', 'גיל', 'כיתה', 'בית ספר', 'סניף', 'קבוצה', 'שם ההורה', 'טלפון', 'טלפון נוסף', 'מייל', 'כתובת',
  'סטטוס', 'תאריך הצטרפות', 'מסלול התשלום', 'שכר לימוד', 'הנחה', 'דמי רישום', 'שולם', 'יתרה', 'תשלום',
  'אישור צילום', 'הסכמה לתפוצה', 'הסכמה לוואטסאפ', 'תאריך אישור התקנון', 'הערות'];
const CONTACT = ['טלפון', 'טלפון נוסף', 'מייל', 'כתובת'];
const NUMERIC = ['גיל', 'שכר לימוד', 'הנחה', 'דמי רישום', 'שולם', 'יתרה'];
const DATES = ['תאריך לידה', 'תאריך הצטרפות', 'תאריך אישור התקנון'];
const STATUS = { active: 'פעילה', pending: 'ממתינה', stopped: 'הפסיקה', graduated: 'סיימה' };

// ─── נתוני הבדיקה: חמש תלמידות בשני סניפים, עם כל הפרטים ───
const cleanup = () => sql(`delete from payments where student_id in (select id from students where full_name like '${PREFIX}%');
  delete from students where full_name like '${PREFIX}%'`);
cleanup();
const seed = [
  // [שם, סניף, תאריך לידה, טלפון, טלפון נוסף, מייל, כתובת, סטטוס, שכר, הנחה, דמי רישום, תשלומים, מסלול, צילום, תפוצה, וואטסאפ, תקנון, הערות]
  ['א', BEITAR, '2016-03-04', '972501110001', '972521110001', 'rachel.export@example.com', 'הנביאים 5, ביתר', 'active', 2000, 100, 150, [350, 200], 'הוראת קבע ב-10 תשלומים', true, false, true, '2026-09-02 00:30+03', 'הערה בעברית'],
  ['ב', BEITAR, '2015-11-30', '972501110002', null, 'leah.export@example.com', 'הרצל 1', 'pending', 1800, 0, 0, [], 'מזומן', false, true, null, null, '=1+1'],
  ['ג', BEITAR, null, '972501110003', null, null, null, 'active', 1000, 0, 0, [1000], null, true, true, false, '2026-08-15 12:00+03', null],
  ['ד', MODIIN, '2017-01-01', '972501110004', null, 'dina.export@example.com', 'החשמונאים 7', 'active', 2400, 0, 200, [100], 'אשראי — תשלום אחד', true, false, true, '2026-09-10 09:00+03', null],
  ['ה', MODIIN, '2014-06-06', '972501110005', null, null, null, 'active', 1500, 0, 0, [1500], null, false, false, null, null, null],
];
const q = (v) => (v === null || v === undefined ? 'null' : typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : String(v));
for (const [suffix, branch, birth, ph, alt, email, addr, status, tuition, discount, fee, pays, track, photo, mailing, wa, terms, notes] of seed) {
  const id = sql(`with i as (insert into students (season_id, branch_id, full_name, birth_date, grade, school, group_name, parent_name, parent_phone, alt_phone,
      email, address, status, joined_on, tuition_total, discount, registration_fee, installments_total, photo_consent, mailing_consent,
      whatsapp_opt_in, terms_accepted_at, notes, payment_track)
    values ((select id from seasons where is_current), '${branch}', '${PREFIX} ${suffix}', ${q(birth)}, 'ד', 'בית יעקב', 'קבוצה ${suffix}',
      'הורה ${suffix}', ${q(ph)}, ${q(alt)}, ${q(email)}, ${q(addr)}, '${status}', '2026-09-01', ${tuition}, ${discount}, ${fee},
      ${track ? 10 : 'null'}, ${photo}, ${mailing}, ${q(wa)}, ${q(terms)}, ${q(notes)},
      ${track ? `jsonb_build_object('label', ${q(track)}, 'method', 'standing_order')` : 'null'}) returning id) select id from i`);
  for (const amount of pays) sql(`insert into payments (student_id, paid_on, amount, method, source) values ('${id}', '2026-09-15', ${amount}, 'cash', 'manual')`);
}

// ─── הצפוי: מחושב כאן, מהמסד ───
const localPhone = (p) => (p ? `0${p.slice(3, 5)}-${p.slice(5, 8)}-${p.slice(8)}` : null);
function expectedRows(where) {
  const json = sql(`select coalesce(json_agg(x order by x.full_name), '[]') from (
    select s.id, s.full_name, to_char(s.birth_date, 'DD/MM/YYYY') birth, extract(year from age(current_date, s.birth_date))::int age, s.grade, s.school,
           b.name branch, s.group_name, s.parent_name, s.parent_phone, s.alt_phone, s.email, s.address, s.status, to_char(s.joined_on, 'DD/MM/YYYY') joined,
           s.payment_track ->> 'label' track, s.external_payment ext, s.tuition_total::float8 tuition, s.discount::float8 discount, s.registration_fee::float8 fee,
           coalesce((select sum(amount) from payments p where p.student_id = s.id and p.deleted_at is null), 0)::float8 paid,
           (s.tuition_total - s.discount + s.registration_fee - coalesce((select sum(amount) from payments p where p.student_id = s.id and p.deleted_at is null), 0))::float8 balance,
           (select count(*) from payments p where p.student_id = s.id and p.deleted_at is null)::int pays, coalesce(s.installments_total, s.installments) planned,
           s.photo_consent, s.mailing_consent, s.whatsapp_opt_in, to_char(s.terms_accepted_at at time zone 'Asia/Jerusalem', 'DD/MM/YYYY') terms, s.notes
    from students s join branches b on b.id = s.branch_id where s.deleted_at is null and ${where}) x`);
  return JSON.parse(json);
}
const yn = (v) => (v === true ? 'כן' : v === false ? 'לא' : null);
const cellsOf = (e) => ({
  'שם מלא': e.full_name, 'תאריך לידה': e.birth, 'גיל': e.age, 'כיתה': e.grade, 'בית ספר': e.school, 'סניף': e.branch, 'קבוצה': e.group_name,
  'שם ההורה': e.parent_name, 'טלפון': localPhone(e.parent_phone), 'טלפון נוסף': localPhone(e.alt_phone), 'מייל': e.email, 'כתובת': e.address,
  'סטטוס': STATUS[e.status] ?? e.status, 'תאריך הצטרפות': e.joined, 'מסלול התשלום': e.ext ? 'תשלום חיצוני' : e.track,
  'שכר לימוד': e.tuition, 'הנחה': e.discount, 'דמי רישום': e.fee, 'שולם': e.paid, 'יתרה': e.balance,
  'תשלום': e.planned ? `${e.pays} מתוך ${e.planned}` : e.pays ? `${e.pays} תשלומים` : null,
  'אישור צילום': yn(e.photo_consent), 'הסכמה לתפוצה': yn(e.mailing_consent), 'הסכמה לוואטסאפ': yn(e.whatsapp_opt_in),
  'תאריך אישור התקנון': e.terms,
  // תא שמתחיל ב-= מנוטרל (גרש) — אחרת אקסל מריץ אותו כנוסחה.
  'הערות': e.notes && /^[=+\-@]/.test(e.notes) ? `'${e.notes}` : e.notes,
});

/** לוחצים "ייצוא לאקסל", תופסים את ההורדה וקוראים את החוברת. */
async function exportFrom(page, button) {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), button.click()]);
  const chunks = [];
  for await (const c of await download.createReadStream()) chunks.push(c);
  const wb = core.readWorkbook(new Uint8Array(Buffer.concat(chunks)));
  return { name: download.suggestedFilename(), aoa: core.sheetToAoa(wb), rtl: wb.Workbook?.Views?.[0]?.RTL === true };
}
function compare(aoa, expected, headers) {
  const bad = [];
  const [head, ...body] = aoa;
  if (JSON.stringify(head) !== JSON.stringify(headers)) bad.push(`כותרות: ${JSON.stringify(head)}`);
  if (body.length !== expected.length) bad.push(`${body.length} שורות, צפוי ${expected.length}`);
  expected.forEach((e, i) => {
    const want = cellsOf(e);
    headers.forEach((h, j) => {
      const got = body[i]?.[j] ?? null, w = want[h] ?? null;
      if (got !== w) bad.push(`[${e.full_name} · ${h}] ${JSON.stringify(got)} ≠ ${JSON.stringify(w)}`);
    });
  });
  return bad;
}

const { check, failed } = reporter();
const ui = await startUi();
try {
  console.log('\nבעלים — מסך התלמידות, עם סינון:');
  {
    const { page, log } = await ui.newPage(USERS.owner);
    await page.goto(`${ui.app}/students`, { waitUntil: 'domcontentloaded' });
    const search = page.getByLabel('חיפוש תלמידות');
    await search.waitFor({ timeout: 15000 });
    await page.locator('tbody tr').first().waitFor({ timeout: 10000 });
    check('★ עמודת מייל בטבלה', (await page.locator('thead th', { hasText: 'מייל' }).count()) === 1);
    await search.fill('leah.export@');
    await page.waitForTimeout(300);
    const byMail = await page.locator('tbody tr').allInnerTexts();
    check('★ חיפוש לפי מייל מוצא את התלמידה', byMail.length === 1 && byMail[0].includes(`${PREFIX} ב`) && byMail[0].includes('leah.export@example.com'), byMail.join(' | '));

    await search.fill(PREFIX);
    await page.getByLabel('סינון לפי יתרה').selectOption('owing');
    await page.waitForTimeout(300);
    const shown = (await page.locator('tbody tr td:first-child').allInnerTexts()).map((t) => t.trim());
    const owing = expectedRows(`s.full_name like '${PREFIX}%' and (s.tuition_total - s.discount + s.registration_fee - coalesce((select sum(amount) from payments p where p.student_id = s.id and p.deleted_at is null), 0)) > 0`);
    check('על המסך: רק החייבות מהחיפוש', JSON.stringify(shown) === JSON.stringify(owing.map((e) => e.full_name)), `${shown.join(', ')} מול ${owing.map((e) => e.full_name).join(', ')}`);

    const file = await exportFrom(page, page.getByRole('button', { name: 'ייצוא לאקסל' }));
    check('קובץ xlsx, בשם בעברית, בגיליון מימין לשמאל', /^תלמידות-\d{4}-\d{2}-\d{2}\.xlsx$/.test(file.name) && file.rtl, file.name);
    const names = file.aoa.slice(1).map((r) => r[0]);
    check('★ הייצוא מכבד את הסינון: בדיוק השורות שעל המסך, באותו סדר', JSON.stringify(names) === JSON.stringify(shown), names.join(', '));
    const bad = compare(file.aoa, owing, HEADERS);
    check('★ כל תא זהה למסד (קריאה חוזרת, תא-תא)', bad.length === 0, bad.slice(0, 6).join('\n'));
    const col = (h) => HEADERS.indexOf(h);
    const body = file.aoa.slice(1);
    check('★ מספרים נשארים מספרים', NUMERIC.every((h) => body.every((r) => r[col(h)] === null || typeof r[col(h)] === 'number')));
    check('★ תאריכים dd/MM/yyyy', DATES.every((h) => body.every((r) => r[col(h)] === null || /^\d{2}\/\d{2}\/\d{4}$/.test(r[col(h)]))));
    check('★ עברית תקינה', body.every((r) => /^ייצוא בדיקה [א-ת]$/.test(r[0]) && /[א-ת]/.test(r[col('סניף')])));
    check('תקנון שאושר אחרי חצות בישראל — התאריך הישראלי (02/09, לא 01/09)', body.find((r) => r[0] === `${PREFIX} א`)?.[col('תאריך אישור התקנון')] === '02/09/2026');

    // הכרטיס: המייל ליד הטלפון, כקישור
    await search.fill(`${PREFIX} א`);
    await page.getByLabel('סינון לפי יתרה').selectOption('');
    await page.locator('tbody tr', { hasText: `${PREFIX} א` }).first().click();
    const mail = page.getByRole('dialog').locator('a[href="mailto:rachel.export@example.com"]');
    check('★ המייל בכרטיס התלמידה, כקישור', await mail.waitFor({ timeout: 8000 }).then(() => true, () => false));
    await page.getByRole('dialog').getByRole('button', { name: 'סגירה' }).click();

    console.log('\nבעלים — מסך הסניף:');
    await page.goto(`${ui.app}/branches/${BEITAR}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'ייצוא לאקסל' }).waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    const bfile = await exportFrom(page, page.getByRole('button', { name: 'ייצוא לאקסל' }));
    const branchAll = expectedRows(`s.branch_id = '${BEITAR}'`);
    check('★ כל תלמידות הסניף, ורק הן', bfile.aoa.length - 1 === branchAll.length && bfile.aoa.slice(1).every((r) => r[col('סניף')] === 'ביתר עילית'),
      `${bfile.aoa.length - 1} מול ${branchAll.length}`);
    check('★ ...ושם הקובץ נושא את שם הסניף', bfile.name.startsWith('תלמידות - ביתר עילית'), bfile.name);
    const bbad = compare(bfile.aoa, branchAll, HEADERS);
    check('★ כל תא זהה למסד', bbad.length === 0, bbad.slice(0, 6).join('\n'));
    const s = await screenState(page);
    check('בלי קריסה, שאילתות שנדחו או שגיאות JS', !s.crashed && log.badResponses.length === 0 && log.pageErrors.length === 0, [...log.badResponses, ...log.pageErrors].join('\n'));
  }

  console.log('\nמנהלת סניף:');
  {
    const { page } = await ui.newPage(USERS.branch_manager);
    await page.goto(`${ui.app}/students`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('חיפוש תלמידות').waitFor({ timeout: 15000 });
    await page.locator('tbody tr').first().waitFor({ timeout: 10000 });
    const file = await exportFrom(page, page.getByRole('button', { name: 'ייצוא לאקסל' }));
    const mine = sql(`select string_agg(b.name, ',') from branches b where b.id in (select branch_id from branch_staff where user_id = '${USERS.branch_manager}')`).split(',');
    const branches = new Set(file.aoa.slice(1).map((r) => r[HEADERS.indexOf('סניף')]));
    check('★ מנהלת סניף מייצאת רק את הסניף שלה', [...branches].every((b) => mine.includes(b)) && !file.aoa.some((r) => String(r[0]).startsWith(`${PREFIX} ד`)), [...branches].join(','));
    const bad = compare(file.aoa, expectedRows(`s.branch_id in (select branch_id from branch_staff where user_id = '${USERS.branch_manager}')`), HEADERS);
    check('★ ...כל התלמידות שלה, וכל תא זהה למסד', bad.length === 0, bad.slice(0, 4).join('\n'));
  }

  console.log('\nרואת חשבון:');
  {
    const { page, log } = await ui.newPage(USERS.accountant);
    await page.goto(`${ui.app}/students`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('חיפוש תלמידות').waitFor({ timeout: 15000 });
    const rowsShown = await page.locator('tbody tr').first().waitFor({ timeout: 10000 }).then(() => page.locator('tbody tr').count(), () => 0);
    check('★ רואת חשבון רואה את התלמידות (עד עכשיו המסך היה ריק)', rowsShown > 0, `${rowsShown} שורות`);
    check('...בלי טלפונים ומיילים על המסך', !(await page.locator('tbody').innerText()).match(/05\d-\d{3}-\d{4}|@example\.com/));
    await page.getByLabel('חיפוש תלמידות').fill(PREFIX);
    await page.waitForTimeout(300);
    const file = await exportFrom(page, page.getByRole('button', { name: 'ייצוא לאקסל' }));
    const headers = HEADERS.filter((h) => !CONTACT.includes(h));
    check('★ בקובץ אין עמודות טלפון, טלפון נוסף, מייל וכתובת', JSON.stringify(file.aoa[0]) === JSON.stringify(headers), JSON.stringify(file.aoa[0]));
    const flat = JSON.stringify(file.aoa);
    check('★ ואף ערך שלהן לא מופיע בשום תא', !/05\d-\d{3}-\d{4}|9725\d{8}|export@example|הנביאים|הרצל|החשמונאים/.test(flat));
    const bad = compare(file.aoa, expectedRows(`s.full_name like '${PREFIX}%'`), headers);
    check('★ שאר הפרטים — כל תא זהה למסד', bad.length === 0, bad.slice(0, 4).join('\n'));
    check('בלי שאילתות שנדחו ובלי שגיאות JS', log.badResponses.length === 0 && log.pageErrors.length === 0, [...log.badResponses, ...log.pageErrors].join('\n'));
  }
} finally {
  await ui.stop();
  cleanup();
}
console.log(failed() === 0 ? '\nייצוא התלמידות — כל הבדיקות עברו' : `\n${failed()} בדיקות נכשלו`);
process.exit(failed() ? 1 : 0);
