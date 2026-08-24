'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

/** מנסה רשימת סלקטורים ומחזיר את הראשון שנמצא בפועל */
async function firstVisible(page, selectors, timeoutMs) {
  const t = timeoutMs || 8000;
  const deadline = Date.now() + t;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      try {
        const loc = page.locator(sel).first();
        if (await loc.count() > 0 && await loc.isVisible()) return loc;
      } catch (e) { /* סלקטור לא תקין — ממשיכים */ }
    }
    await page.waitForTimeout(300);
  }
  return null;
}

/** סוגר באנרים, הודעות עוגיות וכל מה שחוסם */
async function dismissAll(page, selectors) {
  for (const sel of selectors || []) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.count() > 0 && await loc.isVisible()) {
        await loc.click({ timeout: 2500 });
        await page.waitForTimeout(600);
      }
    } catch (e) { /* לא קריטי */ }
  }
}

/**
 * הודעות ביניים שהמנועים מציגים בזמן שהם עדיין עובדים.
 *
 * למה זה קיים: Gemini מציג "מחפש באינטרנט" או "מתחבר אל מפות Google"
 * בתוך אותו אזור שבו תופיע התשובה. הטקסט הזה קצר ויושב יציב כמה שניות,
 * ולכן המתנה שמסתמכת רק על "הטקסט הפסיק להשתנות" חושבת שהתשובה הסתיימה
 * ושומרת את הודעת הטעינה במקום התשובה.
 */
const WORKING_HINTS = [
  'מחפש באינטרנט', 'מתחבר אל', 'חושב', 'מנתח', 'עובד על זה', 'רק רגע',
  'searching the internet', 'searching', 'thinking', 'analyzing',
  'connecting to', 'working on it', 'just a sec'
];

/** האם הטקסט הוא הודעת ביניים ולא תשובה */
function looksLikeWorking(text) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return true;
  // תשובה אמיתית ארוכה בהרבה מהודעת סטטוס
  if (t.length > 120) return false;
  const low = t.toLowerCase();
  return WORKING_HINTS.some(h => low.indexOf(h.toLowerCase()) !== -1);
}

/**
 * סימנים לכך שגוגל חסמה אותנו במקום להציג תוצאות.
 *
 * למה זה חשוב: בלי הזיהוי הזה, דף "אני לא רובוט" נראה למערכת כמו דף חיפוש
 * שפשוט אין בו בלוק AI — והתא נרשם עם ההסבר "לא הוצג בלוק AI".
 * זה הסבר שקרי. "נחסמנו" ו"גוגל לא הציגה בלוק" הם שני דברים שונים,
 * גם אם שניהם בסוף נרשמים כלא-נמדד.
 */
const BLOCK_HINTS = [
  'אני לא רובוט', 'לא רובוט', 'תעבורה חריגה', 'תנועה חריגה',
  "i'm not a robot", 'im not a robot', 'unusual traffic',
  'our systems have detected', 'verify you are human', 'are you a robot'
];

/** האם הדף הנוכחי הוא דף חסימה או אימות אנושי */
async function looksBlocked(page) {
  try {
    const url = String(page.url() || '');
    if (/\/sorry\/|\/recaptcha\//.test(url)) return true;
  } catch (e) { /* ממשיכים */ }

  try {
    const frames = await page.locator('iframe[src*="recaptcha"], iframe[title*="reCAPTCHA"]').count();
    if (frames > 0) return true;
  } catch (e) { /* ממשיכים */ }

  try {
    // רק ראש הדף — טקסט מלא של דף תוצאות עלול להכיל את המילים האלה במקרה
    const body = String(await page.locator('body').innerText()).slice(0, 600).toLowerCase();
    return BLOCK_HINTS.some(h => body.indexOf(h.toLowerCase()) !== -1);
  } catch (e) { return false; }
}

/** האם אחד מהסלקטורים נראה על המסך כרגע */
async function anyVisible(page, selectors) {
  for (const sel of selectors || []) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.count() > 0 && await loc.isVisible()) return true;
    } catch (e) { /* סלקטור לא תקין — ממשיכים */ }
  }
  return false;
}

/** קורא את הטקסט מאזור התשובה */
async function readAnswer(page, answerSelectors) {
  for (const sel of answerSelectors) {
    try {
      const els = page.locator(sel);
      if (await els.count() > 0) return await els.last().innerText();
    } catch (e) { /* ממשיכים */ }
  }
  return '';
}

/**
 * ממתין עד שהתשובה באמת הסתיימה.
 *
 * שלושה תנאים יחד, ולא רק אחד:
 *   1. הטקסט לא השתנה במשך settleMs
 *   2. כפתור העצירה לא מוצג — כלומר המנוע לא עדיין מייצר
 *   3. הטקסט אינו הודעת ביניים
 *
 * מחזיר { settled, text }.
 */
async function waitForSettle(page, answerSelectors, settleMs, maxWaitMs, stopSelectors) {
  const start = Date.now();
  let last = null, stableSince = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const text = await readAnswer(page, answerSelectors);
    const busy = await anyVisible(page, stopSelectors);

    if (text !== last) { last = text; stableSince = Date.now(); }
    if (busy) stableSince = Date.now();

    if (!busy && text && !looksLikeWorking(text) && Date.now() - stableSince > settleMs) {
      return { settled: true, text };
    }
    await page.waitForTimeout(700);
  }
  return { settled: false, text: last || '' };
}

/** מה שבאמת נמצא בתוך השדה — textarea ו-contenteditable נקראים אחרת */
async function typedText(loc) {
  try {
    return await loc.evaluate(el => (el.value !== undefined ? el.value : el.innerText) || '');
  } catch (e) {
    return '';
  }
}

/**
 * מקליד כמו אדם, ואז מוודא שהטקסט באמת נכנס.
 *
 * הקלדה לתוך שדה שנראה נכון אבל אינו מקבל פוקוס נכשלת בשקט: המנוע שולח,
 * המסך ריק, והתוצאה נרשמת כאילו נמדדה. עדיף להיכשל ברעש.
 */
async function humanType(loc, text) {
  await loc.click();
  await loc.type(text, { delay: 25 + Math.random() * 45 });

  if ((await typedText(loc)).trim()) return;

  // ניסיון שני: מילוי ישיר. עוזר כשההקלדה תו-תו נבלעה על ידי עורך עשיר.
  try { await loc.fill(text); } catch (e) { /* fill לא נתמך בכל שדה */ }
  if ((await typedText(loc)).trim()) return;

  throw new Error('השאלה לא נכנסה לשדה הקלט — הוא נמצא אבל לא קיבל את הטקסט');
}

/** השהיה אקראית בין שאלות — חובה, מונע חסימות */
function pause(minMs, maxMs) {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise(r => setTimeout(r, ms));
}

function shotPath(runId, engine, qIndex) {
  const dir = path.join(ROOT, 'data', 'screenshots', String(runId));
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${engine}-q${String(qIndex + 1).padStart(2, '0')}.png`);
}

/**
 * אוסף את הקישורים היוצאים.
 *
 * קודם בתוך אזור התשובה, וזה הנכון כשהמנוע שם אותם שם.
 * Gemini לא: הוא מציג את המקורות מחוץ לאלמנט התשובה, ולכן סריקה של
 * האזור בלבד החזירה אפס קישורים וטבלת המקורות בדוח נעלמה לגמרי.
 * כשהאזור ריק — סורקים את כל הדף. דומייני התשתית מסוננים ממילא
 * בשלב הניתוח, אז רשת רחבה כאן לא מזהמת את התוצאה.
 */
async function collectLinks(page, containerSelectors, linkSelector) {
  const sel = linkSelector || "a[href^='http']";
  const urls = [];

  for (const c of containerSelectors || []) {
    try {
      const box = page.locator(c).last();
      if (await box.count() === 0) continue;
      const links = box.locator(sel);
      const n = await links.count();
      for (let i = 0; i < n && i < 60; i++) {
        const href = await links.nth(i).getAttribute('href');
        if (href) urls.push(href);
      }
      if (urls.length) break;
    } catch (e) { /* ממשיכים */ }
  }

  if (!urls.length) {
    try {
      const links = page.locator(sel);
      const n = await links.count();
      for (let i = 0; i < n && i < 120; i++) {
        const href = await links.nth(i).getAttribute('href');
        if (href) urls.push(href);
      }
    } catch (e) { /* ממשיכים */ }
  }

  return urls;
}

module.exports = { firstVisible, dismissAll, waitForSettle, readAnswer, anyVisible, typedText,
                   looksLikeWorking, looksBlocked, humanType, pause, shotPath, collectLinks,
                   ROOT, WORKING_HINTS, BLOCK_HINTS };
