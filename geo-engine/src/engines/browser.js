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

/** הקלדה בקצב אנושי */
async function humanType(loc, text) {
  await loc.click();
  await loc.type(text, { delay: 25 + Math.random() * 45 });
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

module.exports = { firstVisible, dismissAll, waitForSettle, readAnswer, anyVisible,
                   looksLikeWorking, humanType, pause, shotPath, collectLinks, ROOT, WORKING_HINTS };
