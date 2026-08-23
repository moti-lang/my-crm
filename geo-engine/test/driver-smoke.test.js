'use strict';

/**
 * בדיקת עשן לדרייבר — דורשת דפדפן, לא רשת.
 * הרצה: npm run smoke
 *
 * מפעילה שרת מקומי שמדמה את ה-DOM לפי הסלקטורים שב-config/engines.json,
 * ומריצה מולו את הדרייבר האמיתי של ChatGPT.
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
const chatgpt = require('../src/engines/chatgpt');
const N = require('../src/normalize');
const A = require('../src/analyze');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  ' + extra : '')); }
}

const ANSWER = 'הנה ההמלצות:\n1. בית הקרפיון — מאה שערים.\n2. גולד פיש — ביתר עילית.\n3. דגי הבירה — ירושלים.';

/** mode: ok = הסלקטור הראשון תופס | fallback = רק השני | broken = אף אחד */
function page(mode) {
  const input = mode === 'ok'       ? '<div id="prompt-textarea" contenteditable="true"></div>'
              : mode === 'fallback' ? '<div contenteditable="true"></div>'
              :                       '<div class="renamed-by-openai"></div>';
  return `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"></head><body>
<button aria-label="Close">Close</button>
${input}
<button data-testid="send-button" aria-label="Send">שלח</button>
<div id="out"></div>
<script>
var FULL = ${JSON.stringify(ANSWER)};
document.querySelector('[data-testid=send-button]').addEventListener('click', function(){
  var d = document.createElement('div');
  d.setAttribute('data-message-author-role','assistant');
  document.getElementById('out').appendChild(d);
  var i = 0;
  var iv = setInterval(function(){
    i += 12; d.textContent = FULL.slice(0, i);
    if (i >= FULL.length) {
      clearInterval(iv);
      var a = document.createElement('a');
      a.href = 'https://www.b144.co.il/x'; a.textContent = 'b144'; d.appendChild(a);
      var b = document.createElement('a');
      b.href = 'https://chatgpt.com/self'; b.textContent = 'self'; d.appendChild(b);
    }
  }, 200);
});
</script></body></html>`;
}

function serve(mode) {
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      r.end(page(mode));
    });
    s.listen(0, '127.0.0.1', () => res({ server: s, port: s.address().port }));
  });
}

async function drive(browser, mode, shot) {
  const { server, port } = await serve(mode);
  try {
    const cfg = JSON.parse(JSON.stringify(CFG.chatgpt));
    cfg.url = 'http://127.0.0.1:' + port + '/';
    cfg.waitAfterSubmitMs = 1500; cfg.settleMs = 1500; cfg.maxWaitMs = 20000;
    const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
    try { return await chatgpt.ask(ctx, cfg, 'מי הכי מומלץ לקניית דגים טריים בביתר עילית?', shot); }
    finally { await ctx.close(); }
  } finally { server.close(); }
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
    console.log('\n— מסלול תקין —');
    const shotOk = path.join(dir, 'ok.png');
    const r1 = await drive(browser, 'ok', shotOk);
    ok('אין שגיאה', r1.error === null, String(r1.error));
    ok('הטקסט נקלט', r1.text.indexOf('גולד פיש') !== -1);
    ok('קישורים נאספו', r1.urls.length >= 2);
    ok('דומיין המנוע עצמו מסונן', JSON.stringify(N.domainsOf(r1.urls)) === JSON.stringify(['b144.co.il']));
    ok('צילום מסך נוצר', fs.existsSync(shotOk) && fs.statSync(shotOk).size > 1000);

    const a = A.analyzeCell(r1.text, { name: 'גולד פיש', variants: ['גולדפיש'] },
                            [{ name: 'בית הקרפיון', variants: [] }, { name: 'דגי הבירה', variants: [] }]);
    ok('המיקום נקבע לפי מבנה הרשימה', a.positionBasis === 'list', JSON.stringify(a));
    ok('מקום 2 ברשימה', a.position === 2, JSON.stringify(a));

    console.log('\n— נפילה חזרה לסלקטור חלופי —');
    const r2 = await drive(browser, 'fallback', path.join(dir, 'fb.png'));
    ok('הסלקטור השני ברשימה תופס כשהראשון נעלם', r2.error === null, String(r2.error));
    ok('התשובה עדיין נקלטת', r2.text.indexOf('גולד פיש') !== -1);

    console.log('\n— כל הסלקטורים התיישנו —');
    const shotBad = path.join(dir, 'bad.png');
    const r3 = await drive(browser, 'broken', shotBad);
    ok('מוחזרת שגיאה מפורשת', !!r3.error && r3.error.indexOf('שדה הקלט לא נמצא') === 0, String(r3.error));
    ok('השגיאה מפנה לקובץ הקונפיג', !!r3.error && r3.error.indexOf('config/engines.json') !== -1);
    ok('צילום מסך נשמר גם בכשל', fs.existsSync(shotBad) && fs.statSync(shotBad).size > 1000);
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\n${pass} עברו, ${fail} נכשלו\n`);
  process.exit(fail ? 1 : 0);
})();
