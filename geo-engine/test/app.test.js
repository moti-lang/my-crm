'use strict';

/**
 * בדיקות לממשק המקומי — ניתוב, ולידציה, ומסלול האימות המלא.
 *
 * למה זה קיים: הממשק הוא היום הדרך היחידה שבה המערכת מופעלת בפועל.
 * כל בקשה שמגיעה אליו נכנסת ישירות לפקודות ולמסד, ולכן שגיאת ולידציה
 * אחת שקטה שווה כאן יותר מבאג בלוגיקה.
 *
 * הבדיקות רצות על מסד זמני (GEO_DB) ולא נוגעות בנתונים האמיתיים.
 * הרצה: npm run test:app
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-app-'));
process.env.GEO_DB = path.join(TMP, 'test.db');
process.env.GEO_CONFIG = path.join(TMP, 'config');

const DB = require('../src/db');
const APP = require('../src/app');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  ' + extra : '')); }
}

/* ---------- מסד זמני עם ריצה אחת ---------- */

function seed() {
  const db = DB.open();
  const clientId = DB.upsertClient(db, {
    slug: 'testco', name: 'גולד פיש', nameVariants: ['גולדפיש'],
    trade: 'חנות דגים', city: 'ביתר עילית', domain: 'goldfish.co.il',
    competitors: [{ name: 'בית הקרפיון', variants: ['הקרפיון'] }]
  });
  DB.syncQuestions(db, clientId, ['חנות דגים מומלצת בביתר עילית', 'איפה קונים דגי נוי']);
  const c = DB.getClient(db, 'testco');
  const runId = DB.newRun(db, clientId, 'בדיקה');
  const ids = [];
  ids.push(DB.saveResult(db, {
    runId, questionId: c.questions[0].id, engine: 'chatgpt',
    rawText: 'הכי מומלץ באזור הוא גולד פיש, ואחריו בית הקרפיון.',
    status: 3, rivals: ['בית הקרפיון'], sources: ['goldfish.co.il']
  }));
  ids.push(DB.saveResult(db, {
    runId, questionId: c.questions[1].id, engine: 'chatgpt',
    rawText: 'אפשר לנסות את בית הקרפיון.', status: 0, rivals: ['בית הקרפיון'], sources: []
  }));
  DB.finishRun(db, runId, 'done');
  db.close();
  return { runId, ids };
}

const SEED = seed();

/* ---------- בקשות ---------- */

let PORT = 0;

function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const raw = body === undefined ? null : JSON.stringify(body);
    const r = http.request({
      host: '127.0.0.1', port: PORT, path: p, method,
      headers: raw ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw) } : {}
    }, (res) => {
      let out = '';
      res.on('data', c => { out += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(out); } catch (e) { /* לא כל תשובה היא JSON */ }
        resolve({ code: res.statusCode, text: out, json });
      });
    });
    r.on('error', reject);
    if (raw) r.write(raw);
    r.end();
  });
}

/* ---------- ריצה ---------- */

(async () => {
  const started = await APP.start({ port: 0, open: false });
  PORT = started.port;

  console.log('\n— עמודים —');

  let r = await req('GET', '/');
  ok('העמוד הראשי נטען', r.code === 200 && /<html/i.test(r.text), 'קוד ' + r.code);
  ok('העמוד בעברית ומימין לשמאל', /dir="rtl"/.test(r.text) && /lang="he"/.test(r.text));

  r = await req('GET', '/favicon.ico');
  ok('אין 404 על האייקון', r.code === 204);

  r = await req('GET', '/api/state');
  ok('המצב מחזיר לקוחות', r.code === 200 && r.json.clients.some(c => c.slug === 'testco'));
  ok('המצב מחזיר את הריצה', r.json.runs.some(x => x.id === SEED.runId));
  ok('שם המנוע מתורגם', (r.json.runs.find(x => x.id === SEED.runId) || {}).engineNames === 'ChatGPT');
  ok('רשימת המנועים מלאה', r.json.engines.length === 3);

  console.log('\n— דף האימות —');

  r = await req('GET', '/review?run=' + SEED.runId);
  ok('דף האימות נבנה', r.code === 200 && /<html/i.test(r.text), 'קוד ' + r.code);
  ok('הכפתור שומר ולא מעתיק', r.text.indexOf('שמור אימות') !== -1);
  ok('השמירה פונה לשרת שלנו', r.text.indexOf('/api/verify') !== -1);
  ok('אין שורת פקודה להדבקה', r.text.indexOf('id="cmd"') === -1);
  ok('התשובה המלאה מוצגת', r.text.indexOf('בית הקרפיון') !== -1);

  r = await req('GET', '/review?run=abc');
  ok('ריצה שאינה מספר נדחית', r.code === 400);
  r = await req('GET', '/review?run=999999');
  ok('ריצה שלא קיימת נדחית', r.code === 400 && /לא נמצאה/.test(r.json.error), r.text);

  console.log('\n— ולידציה —');

  r = await req('POST', '/api/run', { slug: '../../etc/passwd' });
  ok('נתיב במקום שם לקוח נדחה', r.code === 400);
  r = await req('POST', '/api/run', { slug: 'testco; rm -rf /' });
  ok('פקודה מוברחת בשם לקוח נדחית', r.code === 400);
  r = await req('POST', '/api/run', { slug: 'testco', engine: 'perplexity' });
  ok('מנוע לא מוכר נדחה', r.code === 400);
  r = await req('POST', '/api/client-add', { file: '../package.json' });
  ok('קובץ מחוץ לתיקיית הלקוחות נדחה', r.code === 400);
  r = await req('POST', '/api/report', { runs: 'לא מספר' });
  ok('דוח בלי ריצות נדחה', r.code === 400);
  r = await req('POST', '/api/open', { file: '../../../etc/hosts' });
  ok('פתיחת קובץ מחוץ לדוחות נדחית', r.code === 400);
  r = await req('GET', '/api/job?id=999');
  ok('ריצה שלא קיימת מחזירה 404', r.code === 404);
  r = await req('GET', '/' + encodeURIComponent('אין-דבר-כזה'));
  ok('נתיב לא מוכר מחזיר 404', r.code === 404);

  console.log('\n— שמירת אימות —');

  r = await req('POST', '/api/verify', { run: SEED.runId, set: '1:x' });
  ok('סימון לא תקין נדחה', r.code === 400);
  r = await req('POST', '/api/verify', { run: SEED.runId, set: SEED.ids[0] + ':2; drop table results' });
  ok('פקודת SQL בשורת הסימון נדחית', r.code === 400);

  const spec = SEED.ids[0] + ':0,' + SEED.ids[1] + ':n';
  r = await req('POST', '/api/verify', { run: SEED.runId, set: spec });
  ok('אימות תקין נשמר', r.code === 200 && r.json.saved === true, r.text);
  ok('הספירה חוזרת לממשק', r.json.changed === 2 && r.json.same === 0, JSON.stringify(r.json));

  const db = DB.open();
  const rows = db.prepare('SELECT id,status,verified_by_human FROM results WHERE run_id=? ORDER BY id').all(SEED.runId);
  db.close();
  ok('הסטטוס שהמשתמש בחר נשמר', rows[0].status === 0, JSON.stringify(rows[0]));
  ok('"לא נמדד" נשמר כ-null ולא כאפס', rows[1].status === null, JSON.stringify(rows[1]));
  ok('שתי התוצאות מסומנות כמאומתות', rows.every(x => x.verified_by_human === 1));

  console.log('\n— עורך הלקוח —');

  r = await req('GET', '/api/client?slug=testco');
  ok('הלקוח נטען לעריכה', r.code === 200 && r.json.name === 'גולד פיש', r.text);
  ok('התחום חוזר', r.json.trade === 'חנות דגים');
  ok('השאלות חוזרות כטקסט', Array.isArray(r.json.questions) && r.json.questions.length === 2,
     JSON.stringify(r.json.questions));
  ok('המתחרים חוזרים עם הצורות', r.json.competitors[0].variants[0] === 'הקרפיון',
     JSON.stringify(r.json.competitors));

  r = await req('GET', '/api/client?slug=' + encodeURIComponent('אין-כזה'));
  ok('לקוח שלא קיים נדחה', r.code === 400);

  r = await req('GET', '/api/client-new');
  ok('מוצע מזהה פנוי ללקוח חדש', /^client\d+$/.test(r.json.slug || ''), JSON.stringify(r.json));

  // עריכה של לקוח קיים: השאלה הראשונה נשארת, נוספת שאלה חדשה
  const edited = {
    slug: 'testco', name: 'גולד פיש', trade: 'חנות דגים וסלטים', city: 'ביתר עילית',
    nameVariants: ['גולדפיש'],
    questions: ['חנות דגים מומלצת בביתר עילית', 'איפה קונים דגי נוי', 'איפה קונים סלטים'],
    competitors: [{ name: 'בית הקרפיון', variants: ['הקרפיון'] }, { name: 'מוקיר שבת', variants: [] }]
  };
  r = await req('POST', '/api/client-save', edited);
  ok('עריכה נשמרת', r.code === 200 && r.json.trade === 'חנות דגים וסלטים', r.text);
  ok('השאלה החדשה נוספה', r.json.questions.length === 3);

  const d2 = DB.open();
  const kept = d2.prepare('SELECT COUNT(*) AS n FROM results WHERE run_id = ?').get(SEED.runId);
  d2.close();
  ok('תוצאות של ריצה קודמת שרדו את העריכה', kept.n === 2, JSON.stringify(kept));

  r = await req('POST', '/api/client-save', { slug: 'testco', isNew: true, name: 'x', questions: ['ש'] });
  ok('לקוח חדש עם מזהה תפוס נדחה', r.code === 400, r.text);
  r = await req('POST', '/api/client-save', { slug: 'ok2', name: '', questions: ['ש'] });
  ok('לקוח בלי שם נדחה', r.code === 400);
  r = await req('POST', '/api/client-save', { slug: 'ok2', name: 'עסק', questions: [] });
  ok('לקוח בלי שאלות נדחה', r.code === 400);
  r = await req('POST', '/api/client-save', { slug: 'לא באנגלית', name: 'עסק', questions: ['ש'] });
  ok('מזהה שאינו באנגלית נדחה', r.code === 400);
  r = await req('POST', '/api/client-save',
                { slug: 'ok2', name: 'עסק', questions: new Array(61).fill('ש') });
  ok('יותר מ-60 שאלות נדחה', r.code === 400);

  r = await req('POST', '/api/client-save', {
    slug: 'pizza', isNew: true, name: 'פיצה יוסי', trade: 'פיצה', city: 'ירושלים',
    questions: ['איפה הפיצה הכי טובה בירושלים?'],
    competitors: [{ name: 'פיצה חנן', variants: ['חנן'] }, { name: '', variants: [] }]
  });
  ok('לקוח חדש נשמר', r.code === 200 && r.json.slug === 'pizza', r.text);
  ok('מתחרה בלי שם מסונן', r.json.competitors.length === 1, JSON.stringify(r.json.competitors));

  r = await req('GET', '/api/state');
  ok('הלקוח החדש מופיע ברשימה', r.json.clients.some(c => c.slug === 'pizza'));

  console.log('\n— מיתוג —');

  // PNG אמיתי, 1x1, כדי שהנתיב יהיה זהה לזה של לוגו שהמשתמש בוחר
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ'
            + 'AAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  r = await req('GET', '/api/brand');
  ok('מיתוג ריק כשאין קובץ', r.code === 200 && r.json.name === '' && r.json.logo === '');
  r = await req('GET', '/api/state');
  ok('הכותרת יודעת שאין מיתוג', r.json.branded === false);

  r = await req('POST', '/api/brand', { name: 'אוטומציה ו-AI', phone: '050-1234567',
                                        email: 'moti@automation1.co.il', logoData: PNG });
  ok('מיתוג נשמר', r.code === 200 && r.json.name === 'אוטומציה ו-AI', r.text);
  ok('הלוגו נשמר כקובץ', /logo\.png$/.test(r.json.logo || ''), JSON.stringify(r.json.logo));
  ok('הלוגו חוזר מוטמע לתצוגה', /^data:image\/png;base64,/.test(r.json.logoData || ''));

  r = await req('GET', '/api/state');
  ok('הכותרת יודעת שיש מיתוג', r.json.branded === true);

  r = await req('GET', '/api/brand');
  ok('הערכים נטענים חזרה לטופס', r.json.phone === '050-1234567' && r.json.email === 'moti@automation1.co.il');

  r = await req('POST', '/api/brand', { name: 'אוטומציה ו-AI', keepLogo: true });
  ok('שמירה בלי בחירת לוגו שומרת עליו', /logo\.png$/.test(r.json.logo || ''), JSON.stringify(r.json.logo));
  r = await req('POST', '/api/brand', { name: 'אוטומציה ו-AI' });
  ok('הסרת לוגו מוחקת אותו מהמיתוג', !r.json.logo);

  r = await req('POST', '/api/brand', { name: 'x', logoData: 'data:application/x-msdownload;base64,TVo=' });
  ok('קובץ שאינו תמונה נדחה', r.code === 400, r.text);
  r = await req('POST', '/api/brand', { name: 'x', logoData: 'לא data URI בכלל' });
  ok('מחרוזת שאינה קובץ נדחית', r.code === 400);
  r = await req('POST', '/api/brand', { email: 'בלי שטרודל' });
  ok('מייל לא תקין נדחה', r.code === 400);
  r = await req('POST', '/api/brand', { name: 'א'.repeat(201) });
  ok('שדה ארוך מדי נדחה', r.code === 400);

  const savedFields = JSON.parse(fs.readFileSync(path.join(TMP, 'config', 'brand.json'), 'utf8'));
  ok('שדות ריקים לא נכתבים לקובץ', !('tagline' in savedFields) && !('site' in savedFields),
     JSON.stringify(savedFields));

  console.log('\n— פתיחה חוזרת —');

  ok('הממשק מזהה את עצמו בפורט', await APP.alreadyMine(PORT));
  ok('פורט ריק אינו מזוהה כממשק', !(await APP.alreadyMine(PORT + 1)));

  started.server.close();
  fs.rmSync(TMP, { recursive: true, force: true });

  console.log(`\n${pass} עברו, ${fail} נכשלו\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('\nהבדיקות נפלו: ' + e.stack);
  process.exit(1);
});
