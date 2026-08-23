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
 * ממתין עד שהתשובה מפסיקה לגדול.
 * מודד את אורך הטקסט כל 700ms; כשלא השתנה במשך settleMs — סיימנו.
 */
async function waitForSettle(page, answerSelectors, settleMs, maxWaitMs) {
  const start = Date.now();
  let lastLen = -1, stableSince = Date.now();
  while (Date.now() - start < maxWaitMs) {
    let len = 0;
    for (const sel of answerSelectors) {
      try {
        const els = page.locator(sel);
        const n = await els.count();
        if (n > 0) { len = (await els.last().innerText()).length; break; }
      } catch (e) { /* ממשיכים */ }
    }
    if (len !== lastLen) { lastLen = len; stableSince = Date.now(); }
    else if (len > 0 && Date.now() - stableSince > settleMs) return true;
    await page.waitForTimeout(700);
  }
  return false;
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

/** אוסף את כל הקישורים היוצאים בתוך אזור התשובה */
async function collectLinks(page, containerSelectors, linkSelector) {
  const urls = [];
  for (const sel of containerSelectors) {
    try {
      const c = page.locator(sel).last();
      if (await c.count() === 0) continue;
      const links = c.locator(linkSelector || "a[href^='http']");
      const n = await links.count();
      for (let i = 0; i < n && i < 60; i++) {
        const href = await links.nth(i).getAttribute('href');
        if (href) urls.push(href);
      }
      if (urls.length) break;
    } catch (e) { /* ממשיכים */ }
  }
  return urls;
}

module.exports = { firstVisible, dismissAll, waitForSettle, humanType, pause, shotPath, collectLinks, ROOT };
