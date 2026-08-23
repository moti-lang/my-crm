'use strict';

const B = require('./browser');

/**
 * Google AI Overviews.
 *
 * הבדל מהותי משאר המנועים: בלוק ה-AI לא תמיד מוצג.
 * "לא הוצג בלוק" הוא לא "העסק לא מופיע" — אלה שני דברים שונים לגמרי.
 * לכן במקרה כזה מוחזר absent=true, והתוצאה נשמרת כ-null ולא כ-0,
 * ואינה נספרת במכנה של הציון.
 */
async function ask(context, cfg, question, shotFile) {
  const page = await context.newPage();
  try {
    const url = cfg.url.replace('{QUERY}', encodeURIComponent(question));
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);
    await B.dismissAll(page, cfg.selectors.dismiss);
    await page.waitForTimeout(cfg.waitAfterSubmitMs);

    let block = null;
    for (const sel of cfg.selectors.aiBlock) {
      try {
        const loc = page.locator(sel).first();
        if (await loc.count() > 0 && await loc.isVisible()) { block = loc; break; }
      } catch (e) { /* ממשיכים */ }
    }

    await page.screenshot({ path: shotFile, fullPage: true });

    if (!block) {
      return { text: '', urls: [], absent: true, error: null };
    }

    await B.waitForSettle(page, cfg.selectors.aiBlock, cfg.settleMs, cfg.maxWaitMs);
    const text = await block.innerText();
    const urls = await B.collectLinks(page, cfg.selectors.aiBlock, cfg.selectors.citations[0]);
    await page.screenshot({ path: shotFile, fullPage: true });

    return { text: text || '', urls, absent: false, error: null };
  } catch (e) {
    try { await page.screenshot({ path: shotFile, fullPage: true }); } catch (_) {}
    return { text: '', urls: [], absent: false, error: e.message };
  } finally {
    await page.close();
  }
}

module.exports = { ask };
