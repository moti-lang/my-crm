#!/usr/bin/env node
/**
 * ★ יום החיוב בהוראת קבע — בדפדפן אמיתי, מול המסד המקומי:
 *   1. הבעלים: "שינוי יום חיוב" → המשפט שמוצג לפני השמירה ("החיוב הבא יהיה ב-…, ואחריו כל … לחודש"),
 *      שמירה → SUMIT מקבלת את התאריך ואת מספר החיובים שנותרו → התאריך אצלנו → ביומן: מי, מתי, מאיזה לאיזה.
 *      הזרימה היא הקוד האמיתי של הפונקציה (_shared/standing-reschedule.ts); רק SUMIT מזויפת (רושמת קריאות).
 *   2. אי-התאמה מול SUMIT במספר החיובים שנותרו — המסך מציג למה, ושום דבר לא משתנה.
 *   3. מנהלת סניף — אין כפתור.
 *   4. ההרשמה: במסלול הוראת קבע ההורה בוחרת יום (חובה, בלי ברירת מחדל), ובדף התשלום הנוסח
 *      שהיא מאשרת מציג את היום ואת התאריכים בפועל.
 * הערכים הצפויים (תאריכים, משפט) מחושבים כאן בנפרד — לא מהקוד שנבדק.
 *   node supabase/tests/billing-day-ui.test.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgrestClient } from '@supabase/postgrest-js';
import { reporter, screenState, signJwt, sql, startUi } from './_ui.mjs';

const dir = mkdtempSync(join(tmpdir(), 'billing-day-ui-'));
const out = join(dir, 'standing-reschedule.mjs');
execFileSync('npx', ['esbuild', 'supabase/functions/_shared/standing-reschedule.ts', '--bundle', '--format=esm', `--outfile=${out}`, '--log-level=error']);
const { rescheduleStanding } = await import(out);

const OWNER = 'cccccccc-0000-0000-0000-000000000001', MANAGER = 'cccccccc-0000-0000-0000-000000000002';
const SHIRA = 'dddddddd-0000-0000-0000-000000000001', BEITAR = 'bbbbbbbb-0000-0000-0000-000000000001';
const LINK = 'eeeeeeee-0000-0000-0000-0000000003a1', ORDER = 'eeeeeeee-0000-0000-0000-0000000003b1';
const RECURRING = 7301, CUSTOMER = 7300;
const ENROLL_LAST = 'יוםבדיקה', ENROLL_PHONE = '972521117788';

// ─── תאריכים בשעון ישראל, מחושבים כאן ───
const p2 = (n) => String(n).padStart(2, '0');
const ilToday = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day) };
};
const monthPlus = ({ y, m }, n) => { const t = y * 12 + (m - 1) + n; return { y: Math.floor(t / 12), m: (t % 12) + 1 }; };
const iso = (y, m, d) => `${y}-${p2(m)}-${p2(d)}`;
const dmy = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
const dm = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;

const T = ilToday();
const B = (T.d % 28) + 1;                                     // יום שונה מהיום הנוכחי בהוראה
const NEXT_MONTH = monthPlus(T, 1);
const EXPECTED_NEXT = iso(NEXT_MONTH.y, NEXT_MONTH.m, B);      // ★ חויבה היום (החודש) → היום שנבחר, בחודש הבא
const FINAL = (() => { const f = monthPlus(T, 7); return iso(f.y, f.m, B); })();   // 7 נותרו: הבא + 6 חודשים
const EXPECTED_SENTENCE = `החיוב הבא יהיה ב-${dm(EXPECTED_NEXT)}, ואחריו כל ${B} לחודש. נשארו 7 חיובים, האחרון ב-${dmy(FINAL)}.`;

const cleanup = () => sql(`
  delete from standing_order_events where standing_order_id = '${ORDER}';
  delete from audit_log where row_id = '${ORDER}';
  delete from system_alerts where meta ->> 'standing_order_id' = '${ORDER}';
  delete from standing_order_charges where standing_order_id = '${ORDER}';
  delete from standing_orders where id = '${ORDER}';
  delete from payment_links where id = '${LINK}';
  delete from reminders where student_id in (select id from students where last_name = '${ENROLL_LAST}');
  delete from payment_links where student_id in (select id from students where last_name = '${ENROLL_LAST}');
  delete from audit_log where row_id in (select id from students where last_name = '${ENROLL_LAST}');
  delete from students where last_name = '${ENROLL_LAST}';
  delete from enrollment_requests where phone = '${ENROLL_PHONE}' or ip = '10.9.9.9'`);
cleanup();
// הוראה פעילה: 9 חיובים, 2 בוצעו — האחרון היום. הבא: בעוד חודש, באותו יום.
sql(`insert into payment_links (id, token, external_identifier, student_id, branch_id, amount, status, paid_at)
       values ('${LINK}', repeat('9', 60) || '3a01', 'bd-ui', '${SHIRA}', '${BEITAR}', 300, 'paid', now() - interval '65 days');
     insert into standing_orders (id, student_id, branch_id, payment_link_id, sumit_customer_id, sumit_recurring_id, amount, installments, installments_total,
                                  date_start, consent_text, consented_at, status, next_billing, last_billing, charged_count, billing_day)
     values ('${ORDER}', '${SHIRA}', '${BEITAR}', '${LINK}', ${CUSTOMER}, ${RECURRING}, 100, 9, 10, f_today_il() - interval '2 months', 'אישור', now() - interval '65 days',
             'active', (f_today_il() + interval '1 month')::date, f_today_il(), 2, extract(day from (f_today_il() + interval '1 month'))::int)`);
const OLD_NEXT = sql(`select next_billing from standing_orders where id = '${ORDER}'`);
const STUDENT = sql(`select full_name from students where id = '${SHIRA}'`);
const OWNER_NAME = sql(`select full_name from profiles where id = '${OWNER}'`);

// ─── SUMIT מזויפת: מחזירה את מצב ההוראה, ורושמת כל קריאה ───
const sumitCalls = [];
const sumitState = { next: OLD_NEXT, prev: sql(`select f_today_il()`), last: sql(`select (next_billing + interval '6 months')::date from standing_orders where id = '${ORDER}'`) };
const sumit = {
  list: async (cid) => { sumitCalls.push({ fn: 'list', cid });
    return [{ ID: RECURRING, Status: 0, Date_NextBilling: `${sumitState.next}T00:00:00+02:00`, Date_PreviousBilling: `${sumitState.prev}T00:00:00+02:00`, Date_Last: `${sumitState.last}T00:00:00+02:00` }]; },
  update: async (i) => { sumitCalls.push({ fn: 'update', ...i }); sumitState.next = i.nextDate; return { ok: true }; },
  create: async () => ({ ok: false, error: 'לא בבדיקה הזו' }), cancel: async () => ({ ok: true }),
};

const { check, failed } = reporter();
const ui = await startUi();
try {
  const service = new PostgrestClient(ui.rest, { headers: { Authorization: `Bearer ${signJwt({ role: 'service_role' })}` } });
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const ownerDb = new PostgrestClient(ui.rest, { headers: { Authorization: `Bearer ${signJwt({ sub: OWNER, role: 'authenticated', aud: 'authenticated', exp })}` } });
  const functions = { 'standing-order-reschedule': async (body) => (await rescheduleStanding(ownerDb, service, sumit, body, OWNER)).body };

  console.log('\nשינוי יום חיוב — הבעלים:');
  {
    const { page, log } = await ui.newPage(OWNER, { functions });
    await page.goto(`${ui.app}/standing-orders`);
    const row = page.locator('tr', { hasText: STUDENT }).first();
    await row.getByRole('button', { name: 'פרטים' }).click();
    await row.getByRole('button', { name: 'שינוי יום חיוב' }).click();
    const form = row.getByTestId('reschedule');
    check('הבחירה: 1 עד 28, בלי יום מסומן מראש', (await form.locator('select option').count()) === 29 && (await form.locator('select').inputValue()) === '');
    check('★ בלי יום — אין שמירה', await form.getByRole('button', { name: 'לשנות ב-SUMIT' }).isDisabled());
    await form.locator('select').selectOption(String(B));
    const sentence = form.getByTestId('reschedule-sentence');
    await sentence.waitFor({ timeout: 8000 });
    check(`★ לפני השמירה — המשפט: "${EXPECTED_SENTENCE}"`, (await sentence.textContent())?.trim() === EXPECTED_SENTENCE, await sentence.textContent());
    check('...ולמה: "כבר חויבה החודש"', (await form.textContent())?.includes('כבר חויבה החודש'));
    check('...ומה יש עכשיו', (await form.textContent())?.includes(`עכשיו: החיוב הבא ב-${dm(OLD_NEXT)}`));
    check('★ עד כאן — שום קריאה ל-SUMIT ושום שינוי', sumitCalls.length === 0 && sql(`select next_billing from standing_orders where id = '${ORDER}'`) === OLD_NEXT);
    await form.getByRole('button', { name: 'לשנות ב-SUMIT' }).click();
    await row.getByRole('status').waitFor({ timeout: 10000 });
    check('★ אחרי השמירה — "נשמר ב-SUMIT" עם אותו משפט', (await row.getByRole('status').textContent())?.includes(EXPECTED_SENTENCE));
    const up = sumitCalls.find((c) => c.fn === 'update');
    check('★ SUMIT: בדיקה ואז עדכון — התאריך החדש ו-7 חיובים שנותרו, להוראה ולקוחה הנכונות',
      JSON.stringify(sumitCalls.map((c) => c.fn)) === '["list","update"]' && up?.nextDate === EXPECTED_NEXT && up?.remaining === 7 && up?.recurringId === RECURRING && up?.customerId === CUSTOMER,
      JSON.stringify(sumitCalls));
    check('★ במסד: החיוב הבא ויום החיוב', sql(`select next_billing || '|' || billing_day from standing_orders where id = '${ORDER}'`) === `${EXPECTED_NEXT}|${B}`);
    check('★ ביומן: מי שינתה, מאיזה תאריך לאיזה', sql(`select kind || '|' || actor || '|' || from_date || '|' || to_date || '|' || to_day || '|' || remaining
                                                   from standing_order_events where standing_order_id = '${ORDER}'`) === `reschedule|${OWNER}|${OLD_NEXT}|${EXPECTED_NEXT}|${B}|7`);
    const journal = page.getByRole('region', { name: 'יומן הוראות הקבע' });
    await journal.waitFor({ timeout: 8000 });
    const jrow = journal.locator('tbody tr', { hasText: STUDENT }).first();
    const jtext = (await jrow.textContent()) ?? '';
    check('★ יומן השינויים במסך: מתי, תלמידה, מי, מה, מתאריך, לתאריך',
      jtext.includes(OWNER_NAME) && jtext.includes('שינוי יום חיוב') && jtext.includes(dmy(OLD_NEXT)) && jtext.includes(dmy(EXPECTED_NEXT)) && /\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/.test(jtext), jtext);
    check('ברשימה: יום החיוב החדש', (await row.textContent())?.includes(`כל ${B} לחודש`));

    // ★ אי-התאמה: לפי SUMIT נותרו 6, לפי המערכת 7 — לא משנים.
    sumitCalls.length = 0;
    sumitState.prev = sql(`select f_today_il()`);
    sumitState.last = sql(`select ('${EXPECTED_NEXT}'::date + interval '5 months')::date`);
    const B2 = (B % 28) + 1;
    await row.getByRole('button', { name: 'שינוי יום חיוב' }).click();
    await form.locator('select').selectOption(String(B2));
    await form.getByTestId('reschedule-sentence').waitFor({ timeout: 8000 });
    await form.getByRole('button', { name: 'לשנות ב-SUMIT' }).click();
    const alert = form.getByRole('alert');
    await alert.waitFor({ timeout: 10000 });
    check('★ אי-התאמה במספר החיובים — המסך אומר למה', (await alert.textContent())?.includes('לפי SUMIT נותרו 6 חיובים, ולפי המערכת 7'), await alert.textContent());
    check('★ ...ושום דבר לא השתנה: אין עדכון ב-SUMIT, התאריך במסד נשאר',
      !sumitCalls.some((c) => c.fn === 'update') && sql(`select next_billing from standing_orders where id = '${ORDER}'`) === EXPECTED_NEXT);
    check('בלי שגיאות דף ובלי שאילתות שבורות', log.pageErrors.length === 0 && log.badResponses.length === 0, [...log.pageErrors, ...log.badResponses].join('\n'));
    await page.close();
  }

  console.log('\nמנהלת סניף:');
  {
    const { page, log } = await ui.newPage(MANAGER, { functions });
    await page.goto(`${ui.app}/standing-orders`);
    const st = await screenState(page);
    const row = page.locator('tr', { hasText: STUDENT }).first();
    if (await row.count()) await row.getByRole('button', { name: 'פרטים' }).click();
    await page.waitForTimeout(500);
    check('★ מנהלת סניף — אין "שינוי יום חיוב"', !st.crashed && (await page.getByRole('button', { name: 'שינוי יום חיוב' }).count()) === 0);
    check('בלי שגיאות דף', log.pageErrors.length === 0, log.pageErrors.join('\n'));
    await page.close();
  }

  console.log('\nיום חיוב בהרשמה:');
  sql(`update settings set value = 'true'::jsonb where key = 'standing_orders_enabled'`);
  try {
    const enrollCalls = [];
    // הפונקציה enroll מעבירה את הגוף כמו שהוא ל-rpc_enroll (עם ה-IP).
    const enrollFns = { enroll: async (body) => { enrollCalls.push(body); return (await service.rpc('rpc_enroll', { p: body, p_ip: '10.9.9.9' })).data; } };
    const { page, log } = await ui.newPage(null, { functions: enrollFns });
    const token = sql(`select enroll_token from branches where id = '${BEITAR}'`);
    const trackLabel = sql(`select t ->> 'label' from jsonb_array_elements(f_plan_check((select plan from branches where id = '${BEITAR}')) -> 'tracks') t where t ->> 'key' = 'so10'`);
    await page.goto(`${ui.app}/enroll/${token}`);
    await page.getByLabel('שם פרטי', { exact: true }).fill('נוגה');
    await page.getByLabel('שם משפחה', { exact: true }).fill(ENROLL_LAST);
    await page.getByLabel('כיתה', { exact: true }).fill('ד');
    await page.getByLabel('בית ספר', { exact: true }).fill('בית יעקב');
    await page.getByLabel('טלפון (נייד)').fill('052-111-7788');
    await page.getByLabel('מייל', { exact: true }).fill('noga@example.com');
    for (const legend of ['וואטסאפ', 'אישור לצילום']) {
      const fs = page.locator('fieldset', { hasText: legend }).last();
      if (await fs.count()) await fs.getByText('כן', { exact: true }).click();
    }
    check('לפני בחירת מסלול — אין שאלת יום חיוב', (await page.getByLabel('יום החיוב בחודש').count()) === 0);
    await page.locator('label', { hasText: trackLabel }).click();
    const daySel = page.getByLabel('יום החיוב בחודש');
    check('★ במסלול הוראת קבע — "באיזה יום בחודש לחייב?", 1 עד 28, בלי ברירת מחדל',
      (await daySel.count()) === 1 && (await daySel.locator('option').count()) === 29 && (await daySel.inputValue()) === '');
    await page.getByText('קראתי את התקנון ואני מאשרת אותו').click();
    await page.getByRole('button', { name: 'הרשמה ומעבר לתשלום' }).click();
    check('★ בלי יום — לא נשלח, והודעה ליד השדה', enrollCalls.length === 0 && (await page.getByText('יש לבחור יום חיוב בחודש (1–28)').count()) === 1);
    await daySel.selectOption('20');
    check('הסבר במילים: ב-20 בכל חודש, מהחודש הבא', (await page.getByText('החיובים החודשיים יהיו ב-20 בכל חודש, החל מהחודש הבא').count()) === 1);
    await page.getByRole('button', { name: 'הרשמה ומעבר לתשלום' }).click();
    const payLink = page.getByRole('link', { name: 'לתשלום בכרטיס אשראי' });
    await payLink.waitFor({ timeout: 10000 });
    check('★ נשלח עם יום החיוב', enrollCalls.length === 1 && enrollCalls[0].billing_day === '20');
    check('★ במסד: היום נשמר במסלול של התלמידה', sql(`select payment_track ->> 'billing_day' from students where last_name = '${ENROLL_LAST}'`) === '20');
    const payToken = /\/pay\/([0-9a-f]+)/.exec((await payLink.getAttribute('href')) ?? '')?.[1];
    await page.goto(`${ui.app}/pay/${payToken}`);
    const consent = page.locator('label', { hasText: 'אני מאשרת חיוב' });
    await consent.waitFor({ timeout: 8000 });
    const text = (await consent.textContent())?.trim() ?? '';
    const dates = Array.from({ length: 9 }, (_, i) => { const m = monthPlus(T, i + 1); return dmy(iso(m.y, m.m, 20)); });
    check('★ הנוסח שההורה מאשרת: היום שנבחר', text.includes('9 חיובים חודשיים של') && text.includes('ב-20 בכל חודש, בתאריכים הבאים:'), text);
    check(`★ ...והתאריכים בפועל: ${dates[0]} עד ${dates[8]}`, text.endsWith(`בתאריכים הבאים: ${dates.join(', ')}`), text);
    check('★ התיבה לא מסומנת, והתשלום חסום עד הסימון', !(await consent.locator('input[type=checkbox]').isChecked())
          && await page.getByRole('button', { name: 'לתשלום בכרטיס אשראי' }).isDisabled());
    check('בלי שגיאות דף ובלי שאילתות שבורות', log.pageErrors.length === 0 && log.badResponses.length === 0, [...log.pageErrors, ...log.badResponses].join('\n'));
    await page.close();
  } finally {
    sql(`update settings set value = 'false'::jsonb where key = 'standing_orders_enabled'`);
  }
} finally {
  await ui.stop();
  cleanup();
}
console.log(failed() === 0 ? '\nיום החיוב בהוראת קבע (דפדפן): הכל עבר' : `\n${failed()} בדיקות נכשלו`);
process.exit(failed() ? 1 : 0);
