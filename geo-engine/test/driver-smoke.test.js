'use strict';

/**
 * בדיקת עשן לדרייברים — דורשת דפדפן, לא רשת.
 * הרצה: npm run smoke
 *
 * מפעילה שרת מקומי שמדמה את ה-DOM של כל מנוע לפי הסלקטורים
 * שב-config/engines.json, ומריצה מולו את הדרייבר האמיתי.
 *
 * למה זה קיים: כשריצה אמיתית נכשלת, השאלה הראשונה היא תמיד
 * "הקוד נשבר או שהסלקטור התיישן?". אם הבדיקה הזאת עוברת — הקוד תקין,
 * והבעיה היא בסלקטורים ב-config/engines.json בלבד.
 *
 * אפשר להצביע על בינארי כרומיום ספציפי דרך PW_CHROMIUM.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CFG = require('../config/engines.json');
const N = require('../src/normalize');
const A = require('../src/analyze');

const DRIVERS = {
  chatgpt: require('../src/engines/chatgpt'),
  gemini: require('../src/engines/gemini'),
  google_aio: require('../src/engines/googleAio')
};

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  ' + extra : '')); }
}

const ANSWER = 'הנה ההמלצות:\n1. בית הקרפיון — מאה שערים.\n2. גולד פיש — ביתר עילית.\n3. דגי הבירה — ירושלים.';

const CLIENT = { name: 'גולד פיש', variants: ['גולדפיש'] };
const RIVALS = [{ name: 'בית הקרפיון', variants: [] }, { name: 'דגי הבירה', variants: [] }];

/**
 * מדמה בדיוק את מה ש-Gemini עשה בריצה אמיתית: מציג "מחפש באינטרנט"
 * ומשאיר אותו יציב על המסך, ורק אחר כך מתחיל להזרים את התשובה.
 * המתנה שמסתמכת רק על "הטקסט הפסיק להשתנות" תשמור את הודעת הטעינה.
 */
function slowScript(containerJs) {
  return '<script>\n'
    + 'var FULL = ' + JSON.stringify(ANSWER) + ';\n'
    + 'function emit(){\n'
    + '  var d = ' + containerJs + ';\n'
    + '  var stop = document.createElement("button");\n'
    + '  stop.setAttribute("data-testid","stop-button");\n'
    + '  stop.setAttribute("aria-label","Stop");\n'
    + '  stop.textContent = "עצור"; document.body.appendChild(stop);\n'
    + '  d.textContent = "מחפש באינטרנט";\n'
    + '  setTimeout(function(){\n'
    + '    var i = 0;\n'
    + '    var iv = setInterval(function(){\n'
    + '      i += 12; d.textContent = FULL.slice(0, i);\n'
    + '      if (i >= FULL.length) { clearInterval(iv); stop.remove(); }\n'
    + '    }, 150);\n'
    + '  }, 5200);\n'
    + '}\n'
    + '</script>';
}

/** סקריפט הזרמה משותף — התשובה גדלה בהדרגה, כמו במנוע אמיתי */
function streamScript(containerJs) {
  return '<script>\n'
    + 'var FULL = ' + JSON.stringify(ANSWER) + ';\n'
    + 'function emit(){\n'
    + '  var d = ' + containerJs + ';\n'
    + '  var i = 0;\n'
    + '  var iv = setInterval(function(){\n'
    + '    i += 12; d.textContent = FULL.slice(0, i);\n'
    + '    if (i >= FULL.length) {\n'
    + '      clearInterval(iv);\n'
    + '      var a = document.createElement("a");\n'
    + '      a.href = "https://www.b144.co.il/x"; a.textContent = "b144"; d.appendChild(a);\n'
    + '      var b = document.createElement("a");\n'
    + '      b.href = "https://www.google.com/self"; b.textContent = "self"; d.appendChild(b);\n'
    + '    }\n'
    + '  }, 200);\n'
    + '}\n'
    + '</script>';
}

/**
 * דפי מוק. כל אחד בנוי מהסלקטורים שבקונפיג של אותו מנוע.
 * mode: ok = הסלקטור הראשון תופס | fallback = רק השני | broken = אף אחד
 *       absent = (google בלבד) הדף נטען אבל אין בלוק AI
 */
function page(engine, mode) {
  if (engine === 'chatgpt') {
    const input = mode === 'ok'       ? '<div id="prompt-textarea" contenteditable="true"></div>'
                : mode === 'fallback' ? '<div contenteditable="true"></div>'
                :                       '<div class="renamed-by-openai"></div>';
    return '<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"></head><body>'
      + '<button aria-label="Close">Close</button>' + input
      + '<button data-testid="send-button" aria-label="Send">שלח</button><div id="out"></div>'
      + streamScript('(function(){var d=document.createElement("div");'
        + 'd.setAttribute("data-message-author-role","assistant");'
        + 'document.getElementById("out").appendChild(d);return d;})()')
      + '<script>document.querySelector("[data-testid=send-button]").addEventListener("click",emit);</script>'
      + '</body></html>';
  }

  if (engine === 'gemini-outside') {
    // Gemini מציג את המקורות מחוץ ל-model-response. סריקה של אזור התשובה
    // בלבד מחזירה אפס קישורים, וטבלת המקורות בדוח נעלמת.
    return '<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"></head><body>'
      + '<div class="ql-editor" contenteditable="true"></div>'
      + '<button aria-label="Send">שלח</button><div id="out"></div>'
      + '<div id="sources"></div>'
      + '<script>\n'
      + 'document.querySelector("button[aria-label=Send]").addEventListener("click",function(){\n'
      + '  var d=document.createElement("model-response");\n'
      + '  d.textContent=' + JSON.stringify(ANSWER) + ';\n'
      + '  document.getElementById("out").appendChild(d);\n'
      + '  var s=document.getElementById("sources");\n'
      + '  s.innerHTML=\'<a href="https://www.b144.co.il/x">B144</a>\''
      + ' + \'<a href="https://goldfishbeitar.co.il/">אתר</a>\''
      + ' + \'<a href="https://www.google.com/maps">מפות</a>\';\n'
      + '});\n'
      + '</script></body></html>';
  }

  if (engine === 'gemini-slow') {
    return '<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"></head><body>'
      + '<div class="ql-editor" contenteditable="true"></div>'
      + '<button aria-label="Send">שלח</button><div id="out"></div>'
      + slowScript('(function(){var d=document.createElement("model-response");'
        + 'document.getElementById("out").appendChild(d);return d;})()')
      + '<script>document.querySelector("button[aria-label=Send]").addEventListener("click",emit);</script>'
      + '</body></html>';
  }

  if (engine === 'gemini') {
    // ql-editor הוא העורך של Quill, ו-model-response הוא רכיב מותאם של Gemini
    const input = mode === 'ok'       ? '<div class="ql-editor" contenteditable="true"></div>'
                : mode === 'fallback' ? '<rich-textarea><div contenteditable="true"></div></rich-textarea>'
                :                       '<div class="renamed-by-google"></div>';
    return '<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"></head><body>'
      + '<button>הבנתי</button>' + input
      + '<button aria-label="Send">שלח</button><div id="out"></div>'
      + streamScript('(function(){var d=document.createElement("model-response");'
        + 'document.getElementById("out").appendChild(d);return d;})()')
      + '<script>document.querySelector("button[aria-label=Send]").addEventListener("click",emit);</script>'
      + '</body></html>';
  }

  // דף החסימה של גוגל. נראה כמעט זהה לדף בלי בלוק AI, וזה בדיוק הסיכון:
  // בלי זיהוי מפורש הוא נרשם עם ההסבר השקרי "לא הוצג בלוק AI".
  if (mode === 'blocked') {
    return '<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"></head><body>'
      + '<h1>לפני שאתם ממשיכים</h1>'
      + '<p>המערכות שלנו זיהו תעבורה חריגה מרשת המחשבים שלך. אנא אשר שאינך רובוט.</p>'
      + '<div>אני לא רובוט</div>'
      + '</body></html>';
  }

  // google_aio — אין שדה קלט. השאלה בכתובת, והשאלה היחידה היא אם יש בלוק AI.
  if (mode === 'absent') {
    return '<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"></head><body>'
      + '<button id="L2AGLb">אני מסכים</button>'
      + '<div id="search">תוצאות חיפוש רגילות בלבד, בלי שום בלוק AI.</div>'
      + '</body></html>';
  }
  const block = mode === 'ok' ? 'div data-attrid="SGE"' : 'div id="eob_a"';
  return '<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"></head><body>'
    + '<button id="L2AGLb">אני מסכים</button>'
    + '<' + block + '>' + ANSWER.replace(/\n/g, '<br>')
    + '<a href="https://www.b144.co.il/x">b144</a>'
    + '<a href="https://www.google.com/self">self</a></div>'
    + '</body></html>';
}

function serve(engine, mode) {
  return new Promise(function (res) {
    const s = http.createServer(function (q, r) {
      r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      r.end(page(engine, mode));
    });
    s.listen(0, '127.0.0.1', function () { res({ server: s, port: s.address().port }); });
  });
}

async function drive(browser, engine, mode, shot) {
  const served = await serve(engine, mode);
  const cfgKey = (engine === 'gemini-slow' || engine === 'gemini-outside') ? 'gemini' : engine;
  try {
    const cfg = JSON.parse(JSON.stringify(CFG[cfgKey]));
    cfg.url = engine === 'google_aio'
      ? 'http://127.0.0.1:' + served.port + '/?q={QUERY}'
      : 'http://127.0.0.1:' + served.port + '/';
    cfg.waitAfterSubmitMs = 1500;
    cfg.settleMs = 1500;
    cfg.maxWaitMs = 20000;
    // בדיקת העשן לא אמורה לדרוש קובץ התחברות
    cfg.requiresLogin = false;

    const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
    try {
      return await DRIVERS[cfgKey].ask(ctx, cfg, 'מי הכי מומלץ לקניית דגים טריים בביתר עילית?', shot);
    } finally { await ctx.close(); }
  } finally { served.server.close(); }
}

(async () => {
  let chromium;
  try { chromium = require('playwright').chromium; }
  catch (e) { console.log('\nplaywright לא מותקן. הרץ npm install\n'); process.exit(1); }

  const launch = { headless: false };
  if (process.env.PW_CHROMIUM) launch.executablePath = process.env.PW_CHROMIUM;

  let browser;
  try { browser = await chromium.launch(launch); }
  catch (e) {
    console.log('\nלא הצלחתי להפעיל דפדפן: ' + e.message.split('\n')[0]);
    console.log('הרץ: npx playwright install chromium\n');
    process.exit(1);
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-smoke-'));
  try {
    for (const engine of ['chatgpt', 'gemini']) {
      const label = CFG[engine].label;
      console.log('\n— ' + label + ' · מסלול תקין —');
      const shotOk = path.join(dir, engine + '-ok.png');
      const r1 = await drive(browser, engine, 'ok', shotOk);
      ok('אין שגיאה', r1.error === null, String(r1.error));
      ok('הטקסט נקלט', r1.text.indexOf('גולד פיש') !== -1);
      ok('קישורים נאספו', r1.urls.length >= 2);
      ok('דומיין המנוע עצמו מסונן',
         JSON.stringify(N.domainsOf(r1.urls)) === JSON.stringify(['b144.co.il']));
      ok('צילום מסך נוצר', fs.existsSync(shotOk) && fs.statSync(shotOk).size > 1000);
      const a = A.analyzeCell(r1.text, CLIENT, RIVALS);
      ok('המיקום נקבע לפי מבנה הרשימה', a.positionBasis === 'list', JSON.stringify(a));
      ok('מקום 2 ברשימה', a.position === 2, JSON.stringify(a));

      console.log('— ' + label + ' · נפילה חזרה לסלקטור חלופי —');
      const r2 = await drive(browser, engine, 'fallback', path.join(dir, engine + '-fb.png'));
      ok('הסלקטור השני תופס כשהראשון נעלם', r2.error === null, String(r2.error));
      ok('התשובה עדיין נקלטת', r2.text.indexOf('גולד פיש') !== -1);

      console.log('— ' + label + ' · כל הסלקטורים התיישנו —');
      const shotBad = path.join(dir, engine + '-bad.png');
      const r3 = await drive(browser, engine, 'broken', shotBad);
      ok('מוחזרת שגיאה מפורשת', !!r3.error && r3.error.indexOf('שדה הקלט לא נמצא') === 0, String(r3.error));
      ok('השגיאה מפנה לקובץ הקונפיג', !!r3.error && r3.error.indexOf('config/engines.json') !== -1);
      ok('צילום מסך נשמר גם בכשל', fs.existsSync(shotBad) && fs.statSync(shotBad).size > 1000);
    }

    // הבאג שהתגלה בריצה אמיתית מול Gemini: הודעת טעינה נשמרה כתשובה,
    // והתא נרשם כ"לא מופיע" במקום "לא נמדד".
    console.log('\n— Gemini · הודעת טעינה לפני התשובה —');
    const slow = await drive(browser, 'gemini-slow', 'ok', path.join(dir, 'slow.png'));
    ok('לא נשמרה הודעת הטעינה כתשובה', (slow.text || '').indexOf('מחפש באינטרנט') === -1,
       JSON.stringify((slow.text || '').slice(0, 40)));
    ok('התשובה האמיתית נקלטה', (slow.text || '').indexOf('גולד פיש') !== -1,
       JSON.stringify((slow.text || '').slice(0, 60)));
    ok('אין שגיאה כשהתשובה כן הגיעה', slow.error === null, String(slow.error));

    // וכשהתשובה באמת לא מגיעה — חייב לצאת כלא-נמדד, לא כאפס
    console.log('— Gemini · התשובה לא הגיעה בזמן —');
    const served2 = await serve('gemini-slow', 'ok');
    const cfg2 = JSON.parse(JSON.stringify(CFG.gemini));
    cfg2.url = 'http://127.0.0.1:' + served2.port + '/';
    cfg2.waitAfterSubmitMs = 500; cfg2.settleMs = 500; cfg2.maxWaitMs = 3000;
    const ctx2 = await browser.newContext({ locale: 'he-IL' });
    const shot2 = path.join(dir, 'timeout.png');
    const to = await DRIVERS.gemini.ask(ctx2, cfg2, 'שאלה', shot2);
    await ctx2.close(); served2.server.close();
    ok('מוחזרת שגיאה ולא טקסט חלקי', !!to.error, JSON.stringify(to.text));
    ok('השגיאה אומרת שזה לא נמדד', !!to.error && to.error.indexOf('לא-נמדד') !== -1, String(to.error));
    const aTo = A.analyzeCell(to.text, CLIENT, RIVALS);
    ok('הניתוח מחזיר null ולא 0', aTo.status === null, JSON.stringify(aTo));
    ok('צילום מסך נשמר', fs.existsSync(shot2) && fs.statSync(shot2).size > 1000);

    console.log('— Gemini · מקורות מחוץ לאזור התשובה —');
    const outside = await drive(browser, 'gemini-outside', 'ok', path.join(dir, 'outside.png'));
    ok('אין שגיאה', outside.error === null, String(outside.error));
    ok('קישורים נאספו למרות שהם מחוץ לאלמנט', outside.urls.length >= 2,
       JSON.stringify(outside.urls));
    const doms = N.domainsOf(outside.urls);
    ok('המקורות האמיתיים נשמרו', doms.indexOf('b144.co.il') !== -1
       && doms.indexOf('goldfishbeitar.co.il') !== -1, JSON.stringify(doms));
    ok('דומיין תשתית סונן', doms.indexOf('google.com') === -1, JSON.stringify(doms));

    console.log('\n— ' + CFG.google_aio.label + ' · יש בלוק AI —');
    const g1 = await drive(browser, 'google_aio', 'ok', path.join(dir, 'g-ok.png'));
    ok('אין שגיאה', g1.error === null, String(g1.error));
    ok('הבלוק לא סומן כחסר', g1.absent === false);
    ok('הטקסט נקלט', g1.text.indexOf('גולד פיש') !== -1);
    ok('קישורים נאספו', g1.urls.length >= 1);

    console.log('— ' + CFG.google_aio.label + ' · סלקטור חלופי —');
    const g2 = await drive(browser, 'google_aio', 'fallback', path.join(dir, 'g-fb.png'));
    ok('הסלקטור השני תופס', g2.absent === false && g2.text.indexOf('גולד פיש') !== -1, JSON.stringify(g2.error));

    // הכלל הכי חשוב בפרויקט כולו: דף בלי בלוק AI הוא "לא נמדד", לא "לא מופיע"
    console.log('— ' + CFG.google_aio.label + ' · אין בלוק AI כלל —');
    const shotAbs = path.join(dir, 'g-absent.png');
    const g3 = await drive(browser, 'google_aio', 'absent', shotAbs);
    ok('לא מוחזרת שגיאה', g3.error === null, String(g3.error));
    ok('הבלוק מסומן כחסר', g3.absent === true);
    ok('לא הוחזר טקסט', !g3.text);
    ok('צילום מסך נשמר גם כשאין בלוק', fs.existsSync(shotAbs) && fs.statSync(shotAbs).size > 1000);
    const aAbs = A.analyzeCell(g3.text, CLIENT, RIVALS);
    ok('נרשם כלא-נמדד ולא כאפס', aAbs.status === null, JSON.stringify(aAbs));
    const sc = A.score([{ status: aAbs.status, questionText: 'ש', rivals: [], sources: [] }]);
    ok('אינו נספר במכנה של הציון', sc.measured === 0, JSON.stringify(sc));

    // דף החסימה של גוגל נראה כמעט זהה לדף בלי בלוק AI. בלי זיהוי מפורש
    // הוא נרשם עם ההסבר השקרי "לא הוצג בלוק AI".
    console.log('— ' + CFG.google_aio.label + ' · דף "אני לא רובוט" —');
    const shotBlk = path.join(dir, 'g-blocked.png');
    const g4 = await drive(browser, 'google_aio', 'blocked', shotBlk);
    ok('מזוהה כחסימה', g4.blocked === true, JSON.stringify(g4.error));
    ok('לא מדווח בטעות כ"אין בלוק AI"', g4.absent === false, JSON.stringify(g4));
    ok('השגיאה אומרת שזו חסימה ולא היעדר בלוק',
       !!g4.error && g4.error.indexOf('לא רובוט') !== -1, String(g4.error));
    ok('צילום מסך נשמר כראיה', fs.existsSync(shotBlk) && fs.statSync(shotBlk).size > 1000);
    const aBlk = A.analyzeCell(g4.text, CLIENT, RIVALS);
    ok('נרשם כלא-נמדד ולא כאפס', aBlk.status === null, JSON.stringify(aBlk));
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('\n' + pass + ' עברו, ' + fail + ' נכשלו\n');
  process.exit(fail ? 1 : 0);
})();
