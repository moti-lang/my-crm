'use strict';

const B = require('./browser');

/**
 * ChatGPT — חובה צ׳אט זמני.
 * לכל שאלה נפתח דף חדש לגמרי, כדי שלא יהיה הקשר בין שאלות.
 */
async function ask(context, cfg, question, shotFile) {
  const page = await context.newPage();
  try {
    await page.goto(cfg.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    await B.dismissAll(page, cfg.selectors.dismiss);

    // 15 שניות לא הספיקו לטעינה קרה: העמוד נטען, אבל רק אחרי שכבר ויתרנו
    const input = await B.firstVisible(page, cfg.selectors.input, cfg.inputWaitMs || 45000);
    if (!input) {
      // ‏"הסלקטור התיישן" הוא רק אחד ההסברים, והוא גם היחיד שאי אפשר לעשות
      // איתו כלום בלי לראות. הצילום כבר נשמר — ההודעה מפנה אליו.
      await page.screenshot({ path: shotFile, fullPage: true });
      throw new Error('שדה הקלט לא נמצא. פתח את צילום המסך שנשמר וראה מה הופיע'
        + ' — התחברות, אימות "אני לא רובוט", או שינוי בעמוד:\n  ' + shotFile);
    }

    await B.humanType(input, question);
    await page.waitForTimeout(500);

    const send = await B.firstVisible(page, cfg.selectors.submit, 5000);
    if (send) await send.click();
    else await input.press('Enter');

    await page.waitForTimeout(cfg.waitAfterSubmitMs);
    const settle = await B.waitForSettle(page, cfg.selectors.answer, cfg.settleMs,
                                         cfg.maxWaitMs, cfg.selectors.stopButton);

    let text = settle.text || await B.readAnswer(page, cfg.selectors.answer);

    // תפסנו הודעת ביניים ולא תשובה. זה "לא נמדד" — ובשום אופן לא "לא מופיע",
    // כי לא ראינו את התשובה בכלל.
    if (B.looksLikeWorking(text)) {
      await page.screenshot({ path: shotFile, fullPage: true });
      return {
        text: '', urls: [],
        error: 'התשובה לא הסתיימה בזמן שהוקצב — נרשם כלא-נמדד'
      };
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
