'use strict';

const B = require('./browser');

/**
 * Gemini — דורש חשבון מחובר.
 * מומלץ חשבון ייעודי לבדיקות בלבד.
 * ההתחברות מתבצעת פעם אחת דרך `npm run login -- gemini` ונשמרת ב-data/auth-gemini.json
 */
async function ask(context, cfg, question, shotFile) {
  const page = await context.newPage();
  try {
    await page.goto(cfg.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    await B.dismissAll(page, cfg.selectors.dismiss);

    if (page.url().includes('accounts.google.com')) {
      throw new Error('לא מחובר ל-Gemini. הרץ: npm run login -- gemini');
    }

    const input = await B.firstVisible(page, cfg.selectors.input, 15000);
    if (!input) throw new Error('שדה הקלט לא נמצא — עדכן את הסלקטורים ב-config/engines.json');

    await B.humanType(input, question);
    await page.waitForTimeout(600);

    const send = await B.firstVisible(page, cfg.selectors.submit, 5000);
    if (send) await send.click();
    else await input.press('Enter');

    await page.waitForTimeout(cfg.waitAfterSubmitMs);
    await B.waitForSettle(page, cfg.selectors.answer, cfg.settleMs, cfg.maxWaitMs);

    let text = '';
    for (const sel of cfg.selectors.answer) {
      const loc = page.locator(sel);
      if (await loc.count() > 0) { text = await loc.last().innerText(); break; }
    }

    const urls = await B.collectLinks(page, cfg.selectors.answer, cfg.selectors.citations[0]);
    await page.screenshot({ path: shotFile, fullPage: true });

    return { text: text || '', urls, error: null };
  } catch (e) {
    try { await page.screenshot({ path: shotFile, fullPage: true }); } catch (_) {}
    return { text: '', urls: [], error: e.message };
  } finally {
    await page.close();
  }
}

module.exports = { ask };
