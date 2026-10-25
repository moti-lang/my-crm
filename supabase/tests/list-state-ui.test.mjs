#!/usr/bin/env node
/**
 * ★ מצב הרשימה נשמר בחזרה מכרטיס (בקשת הלקוחה): חיפוש, סינונים, מיון וגלילה.
 *
 * דפדפן אמיתי במסך טלפון, PostgREST אמיתי. מה שנבדק הוא מה שהיא עושה בפועל:
 *   מחפשת → נכנסת לכרטיס → יוצאת (כפתור הסגירה, או "חזרה" בטלפון) → החיפוש עדיין שם,
 *   באותה גלילה. וגם: יציאה למסך אחר וחזרה, וכניסה להפקה וחזרה לרשימת ההפקות.
 *   node supabase/tests/list-state-ui.test.mjs
 */
import { reporter, screenState, sql, startUi } from './_ui.mjs';

const OWNER = 'cccccccc-0000-0000-0000-000000000001';
const PREFIX = 'בדיקת גלילה';
const PROD_PREFIX = 'הפקת גלילה';
const BEITAR = sql(`select id from branches where name = 'ביתר עילית'`);

// מספיק שורות כדי שבמסך טלפון באמת תהיה גלילה.
const cleanup = () => sql(`
  delete from standing_order_charges where standing_order_id = 'eeeeeeee-0000-0000-0000-00000000f1b1';
  delete from standing_orders where id = 'eeeeeeee-0000-0000-0000-00000000f1b1';
  delete from payment_links where id = 'eeeeeeee-0000-0000-0000-00000000f1a1';
  delete from students where full_name like '${PREFIX}%';
  delete from productions where name like '${PROD_PREFIX}%'`);
cleanup();
sql(`insert into students (season_id, branch_id, full_name, status, tuition_total)
     select s.season_id, s.branch_id, '${PREFIX} ' || lpad(g::text, 2, '0'), 'active', 1000 + g
     from students s, generate_series(1, 60) g where s.full_name = 'שירה כהן'`);
sql(`insert into productions (name, status) select '${PROD_PREFIX} ' || g, 'planning' from generate_series(1, 10) g`);
// הוראת קבע אחת (עם קישור התשלום הראשון שלה), כדי שיהיה מה לפתוח במסך הוראות הקבע.
const SO_LINK = 'eeeeeeee-0000-0000-0000-00000000f1a1', SO = 'eeeeeeee-0000-0000-0000-00000000f1b1';
sql(`insert into payment_links (id, token, external_identifier, student_id, branch_id, amount, status)
     select '${SO_LINK}', repeat('f', 64), 'x-list-state', id, branch_id, 100, 'paid' from students where full_name = '${PREFIX} 05';
     insert into standing_orders (id, student_id, branch_id, payment_link_id, sumit_customer_id, sumit_recurring_id, amount, installments,
       installments_total, date_start, consent_text, consented_at, status, next_billing)
     select '${SO}', student_id, branch_id, id, 77, 4545, 100, 3, 4, current_date, 'אישור', now(), 'active', current_date + 20
     from payment_links where id = '${SO_LINK}'`);

const { check, failed } = reporter();
const ui = await startUi();
const near = (a, b, tol = 60) => Math.abs(a - b) <= tol;
try {
  const { page, log } = await ui.newPage(OWNER);
  page.on('dialog', (d) => void d.accept());
  const scrollY = () => page.evaluate(() => Math.round(window.scrollY));
  const scrollTo = async (y) => { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(300); };
  const search = page.getByLabel('חיפוש תלמידות');
  const status = page.getByLabel('סינון לפי סטטוס');
  const drawer = page.getByRole('dialog');
  const nav = (href) => page.locator(`a[href="${href}"]:visible`).first();

  console.log('\nתלמידות — חיפוש, כניסה לכרטיס ויציאה:');
  await page.goto(`${ui.app}/students`, { waitUntil: 'domcontentloaded' });
  await search.waitFor({ timeout: 15000 });
  await search.fill(PREFIX);
  await status.selectOption('active');
  await page.getByRole('button', { name: 'מיון לפי יתרה' }).click();
  await page.getByText(`${PREFIX} 01`).first().waitFor({ timeout: 10000 });
  const countText = async () => (await page.getByText(/\d+ מתוך \d+/).first().textContent())?.trim();
  const before = await countText();
  await scrollTo(900);
  const y0 = await scrollY();
  check('יש גלילה אמיתית במסך (הרשימה ארוכה)', y0 > 500, `scrollY=${y0}`);

  // כניסה לכרטיס — השורה שבאמצע המסך — ויציאה בכפתור הסגירה
  const row = page.locator('tbody tr', { hasText: PREFIX }).nth(20);
  const rowName = (await row.locator('td').first().textContent())?.trim();
  await row.click();
  await drawer.waitFor({ timeout: 10000 });
  check('הכרטיס נפתח (והכתובת מסמנת אותו)', page.url().includes('student='));
  await drawer.getByRole('button', { name: 'סגירה' }).click();
  await drawer.waitFor({ state: 'hidden', timeout: 5000 });
  check('★ אחרי סגירת הכרטיס: טקסט החיפוש עדיין שם', (await search.inputValue()) === PREFIX);
  check('★ ...הסינון והמיון נשארו', (await status.inputValue()) === 'active' && new URL(page.url()).searchParams.get('sort') === 'balance:asc'
    && (await page.getByRole('button', { name: 'מיון לפי יתרה' }).textContent())?.includes('↑'));
  check('★ ...ואותה רשימה (אותה ספירה)', (await countText()) === before, `${before} → ${await countText()}`);
  check('★ ...באותה גלילה', near(await scrollY(), y0), `${y0} → ${await scrollY()}`);

  // "חזרה" בטלפון: סוגרת את הכרטיס — לא יוצאת מהמסך
  await page.locator('tbody tr', { hasText: rowName }).first().click();
  await drawer.waitFor({ timeout: 10000 });
  await page.goBack();
  await drawer.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
  check('★ "חזרה" בטלפון סוגרת את הכרטיס ונשארת ברשימה', new URL(page.url()).pathname === '/students' && !page.url().includes('student=')
    && (await drawer.count()) === 0);
  check('★ ...והחיפוש והגלילה עדיין שם', (await search.inputValue()) === PREFIX && near(await scrollY(), y0), `scrollY=${await scrollY()}`);

  // ★ סגירה כפולה: שתי בקשות סגירה באותו רגע (מחיקה סוגרת, וגם "התלמידה כבר לא ברשימה").
  //   כאן באופן דטרמיניסטי — שתי לחיצות Escape באותה משימה, לפני שה"חזרה" הראשונה עובדה.
  //   (המחיקה עצמה תלויה בתזמון: לפעמים הרענון מקדים, לפעמים לא.)
  await page.locator('tbody tr', { hasText: `${PREFIX} 02` }).first().click();
  await drawer.waitFor({ timeout: 10000 });
  await page.evaluate(() => {
    for (let i = 0; i < 2; i++) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await page.waitForTimeout(800);
  check('★ שתי סגירות רצופות — חוזרים פעם אחת בלבד (נשארים ברשימה, עם החיפוש)',
    new URL(page.url()).pathname === '/students' && (await search.inputValue()) === PREFIX && (await drawer.count()) === 0, page.url());

  // מחיקה מתוך הכרטיס (חלק מהעבודה ברצף): הכרטיס נסגר ונשארים ברשימה.
  await page.locator('tbody tr', { hasText: `${PREFIX} 60` }).first().click();
  await drawer.waitFor({ timeout: 10000 });
  // ★ המרוץ שנתפס בריצה מלאה, כאן באופן דטרמיניסטי: התשלומים של הכרטיס מתעכבים אחרי המחיקה.
  //   הרשימה מתרעננת קודם → הכרטיס נסגר ("כבר לא ברשימה") → ה"חזרה" מעובדת → ורק אז המחיקה
  //   מסתיימת וקוראת לסגירה הישנה שלה. בלי ההגנה — חזרה שנייה, ויציאה מהמסך.
  const slow = /\/rest\/v1\/payments\?/;
  await page.route(slow, async (route) => { await new Promise((r) => setTimeout(r, 2000)); await route.fallback(); });
  await drawer.getByRole('button', { name: 'מחיקת תלמידה' }).click();
  await drawer.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(3000);
  await page.unroute(slow);
  check('★ מחיקה מהכרטיס: נשארים ברשימה, עם החיפוש', new URL(page.url()).pathname === '/students' && (await search.inputValue()) === PREFIX
    && (await page.locator('tbody tr', { hasText: `${PREFIX} 60` }).count()) === 0, page.url());
  const afterDelete = await countText();
  // (הלחיצה על השורה האחרונה גללה אליה — זה המיקום שאיתו יוצאים מהמסך.)
  await scrollTo(800);
  const yLeave = await scrollY();

  // יציאה למסך אחר וחזרה ב"חזרה"
  await nav('/collection').click();
  await page.getByRole('heading', { name: 'גבייה' }).waitFor({ timeout: 10000 });
  await page.goBack();
  await search.waitFor({ timeout: 10000 });
  await page.getByText(`${PREFIX} 01`).first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  check('★ יציאה למסך אחר וחזרה: החיפוש, הסינון והמיון שוחזרו', (await search.inputValue()) === PREFIX
    && (await status.inputValue()) === 'active' && (await countText()) === afterDelete);
  check('★ ...והגלילה שוחזרה', near(await scrollY(), yLeave), `${yLeave} → ${await scrollY()}`);

  // כניסה רגילה מהתפריט = רשימה נקייה מלמעלה (כך לא "נעלמות" תלמידות בגלל סינון ישן)
  await nav('/students').click();
  await page.waitForTimeout(500);
  check('כניסה מהתפריט: רשימה מלאה, בלי חיפוש, מלמעלה', (await search.inputValue()) === '' && (await scrollY()) < 50,
    `search="${await search.inputValue()}" scrollY=${await scrollY()} url=${page.url()}`);

  console.log('\nהפקות — כניסה להפקה וחזרה:');
  await nav('/productions').click();
  await page.getByText(`${PROD_PREFIX} 1`).first().waitFor({ timeout: 10000 });
  await scrollTo(700);
  const py = await scrollY();
  check('יש גלילה ברשימת ההפקות', py > 300, `scrollY=${py}`);
  const card = page.locator(`a[href^="/productions/"]`, { hasText: PROD_PREFIX }).nth(4);
  await card.scrollIntoViewIfNeeded();
  const py2 = await scrollY();
  await card.click();
  await page.getByRole('link', { name: '← כל ההפקות' }).waitFor({ timeout: 10000 });
  await page.getByRole('link', { name: '← כל ההפקות' }).click();
  await page.getByText(`${PROD_PREFIX} 1`).first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  check('★ "כל ההפקות" חוזר לרשימה באותה גלילה', new URL(page.url()).pathname === '/productions' && near(await scrollY(), py2), `${py2} → ${await scrollY()}`);

  console.log('\nהוצאות — סינונים:');
  await nav('/expenses').click();
  const cat = page.getByLabel('סינון לפי קטגוריה');
  await cat.waitFor({ timeout: 10000 });
  await cat.selectOption('תלבושות');
  await page.getByLabel('מתאריך').fill('2025-01-01');
  const expCount = await page.getByText(/\d+ רשומות/).first().textContent();
  await nav('/students').click();
  await search.waitFor({ timeout: 10000 });
  await page.goBack();
  await cat.waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  check('★ חזרה למסך ההוצאות: הקטגוריה והתאריך נשמרו', (await cat.inputValue()) === 'תלבושות' && (await page.getByLabel('מתאריך').inputValue()) === '2025-01-01'
    && (await page.getByText(/\d+ רשומות/).first().textContent()) === expCount);

  console.log('\nגבייה — סניף ולשונית:');
  await nav('/collection').click();
  const branchSel = page.getByLabel('סינון לפי סניף');
  await branchSel.waitFor({ timeout: 10000 });
  await branchSel.selectOption(BEITAR);
  await page.getByRole('button', { name: 'קישורי תשלום והתאמה' }).click();
  await nav('/students').click();
  await search.waitFor({ timeout: 10000 });
  await page.goBack();
  await branchSel.waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  check('★ חזרה למסך הגבייה: הסניף והלשונית נשמרו', (await branchSel.inputValue()) === BEITAR
    && (await page.getByRole('button', { name: 'קישורי תשלום והתאמה' }).getAttribute('aria-pressed')) === 'true');

  console.log('\nהוראות קבע — פרטי הוראה:');
  await nav('/standing-orders').click();
  const soRow = page.locator('tbody tr', { hasText: `${PREFIX} 05` });
  await soRow.waitFor({ timeout: 10000 });
  await soRow.getByRole('button', { name: 'פרטים' }).click();
  await page.waitForTimeout(300);
  check('הפרטים נפתחו (ובכתובת)', (await soRow.getByRole('button', { name: 'פרטים' }).count()) === 0 && page.url().includes('open='));
  await nav('/students').click();
  await search.waitFor({ timeout: 10000 });
  await page.goBack();
  await soRow.waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  check('★ חזרה למסך הוראות הקבע: ההוראה שפתחה עדיין פתוחה', (await soRow.getByRole('button', { name: 'פרטים' }).count()) === 0);

  console.log('\nסניף — כרטיס תלמידה מתוך הסניף:');
  await page.goto(`${ui.app}/branches/${BEITAR}?tab=students`, { waitUntil: 'domcontentloaded' });
  await page.getByText(`${PREFIX} 01`).first().waitFor({ timeout: 15000 });
  await page.locator('tbody tr', { hasText: `${PREFIX} 03` }).first().click();
  await drawer.waitFor({ timeout: 10000 });
  await page.goBack();
  await page.waitForTimeout(400);
  check('★ "חזרה" סוגרת את הכרטיס ונשארת בלשונית התלמידות של הסניף', (await drawer.count()) === 0
    && new URL(page.url()).pathname === `/branches/${BEITAR}` && new URL(page.url()).searchParams.get('tab') === 'students');

  const s = await screenState(page);
  check('בלי קריסה, בלי שאילתות שנדחו ובלי שגיאות JS', !s.crashed && log.badResponses.length === 0 && log.pageErrors.length === 0,
    [s.details, ...log.badResponses, ...log.pageErrors].filter(Boolean).join('\n'));
} finally {
  await ui.stop();
  cleanup();
}
console.log(failed() === 0 ? '\nמצב הרשימות נשמר בחזרה מכרטיס — כל הבדיקות עברו' : `\n${failed()} בדיקות נכשלו`);
process.exit(failed() ? 1 : 0);
