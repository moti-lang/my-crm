'use strict';

const N = require('./normalize');

/**
 * ניתוח תשובה שמורה. רץ offline על הטקסט שנשמר —
 * אפשר להריץ שוב ושוב בלי לפנות למנועים.
 */

// ניסוחים שמעידים על המלצה מפורשת ולא רק אזכור
const RECOMMEND_HINTS = [
  'הכי מומלץ', 'המומלץ ביותר', 'ההמלצה שלי', 'הייתי ממליץ',
  'הבחירה הטובה ביותר', 'האפשרות הבולטת', 'הכי בולט', 'המוביל',
  'top recommendation', 'best choice', 'i recommend'
];

// כמה מילים מותר שיפרידו בין ניסוח ההמלצה לשם הלקוח.
// מעבר לזה — ההמלצה כנראה מתייחסת למישהו אחר.
const MAX_WORDS_BETWEEN = 5;

/**
 * פיצול לפי משפטים. נחוץ כדי לא לייחס ללקוח המלצה
 * שנאמרה על עסק אחר במשפט הקודם.
 * פסיק אינו סוף משפט, ונקודתיים גם לא — "ההמלצה שלי: גולד פיש" הוא משפט אחד.
 */
function sentences(text) {
  return String(text || '')
    .split(/(?<=[.!?…])\s+|\n+/)
    .filter(s => s.trim());
}

/**
 * מזהה רשימה מנויה בתשובה ומחזיר את הפריטים כטקסט.
 * תומך גם ברשימה ממוספרת (1. 2. 3.) בשורות נפרדות או ברצף,
 * וגם בתבליטים. מחזיר [] כשאין מבנה רשימה מזוהה.
 *
 * זה מה שמאפשר לדעת שהלקוח שביעי ברשימה גם כשאף אחד מהשישה
 * שלפניו אינו ברשימת המתחרים שהוגדרה.
 */
function listItems(text) {
  const s = String(text || '');

  const marks = [];
  const re = /(?:^|[\n\s])(\d{1,2})[.)]\s/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    marks.push({ n: parseInt(m[1], 10), markStart: m.index, textStart: m.index + m[0].length });
  }
  // רק רצף עולה שמתחיל ב-1 — כדי לא להתבלבל ממחירים או משנים
  const seq = [];
  for (const mk of marks) {
    const wanted = seq.length === 0 ? 1 : seq[seq.length - 1].n + 1;
    if (mk.n === wanted) seq.push(mk);
  }
  if (seq.length >= 3) {
    return seq.map((mk, i) => s.slice(mk.textStart, i + 1 < seq.length ? seq[i + 1].markStart : s.length));
  }

  const bullets = s.split(/(?:^|\n)\s*[-–—•*]\s+/).slice(1);
  if (bullets.length >= 3) return bullets;

  return [];
}

/**
 * האם קיים ניסוח המלצה שמתייחס ללקוח עצמו.
 * דורש שלושה תנאים יחד: אותו משפט, השם אחרי הניסוח,
 * ולא יותר מ-MAX_WORDS_BETWEEN מילים ביניהם — ובלי שם של מתחרה באמצע.
 */
function recommendsClient(text, clientForms, rivalForms) {
  for (const sent of sentences(text)) {
    const n = N.norm(sent);
    for (const h of RECOMMEND_HINTS) {
      const hn = N.norm(h);
      const hi = n.indexOf(hn);
      if (hi === -1) continue;

      const after = n.slice(hi + hn.length);
      let ci = -1;
      for (const f of clientForms) {
        const i = after.indexOf(f);
        if (i !== -1 && (ci === -1 || i < ci)) ci = i;
      }
      if (ci === -1) continue;

      const between = after.slice(0, ci).trim();
      const words = between ? between.split(/\s+/).length : 0;
      if (words > MAX_WORDS_BETWEEN) continue;
      if (rivalForms.some(f => between.includes(f))) continue;

      return true;
    }
  }
  return false;
}

/**
 * מחשב status לתא בודד.
 * text  — טקסט התשובה
 * client — { name, variants }
 * rivals — [{ name, variants }]
 *
 * מחזיר: { status, position, positionBasis, rivalsFound, recommendHint }
 * status: 0 לא מופיע | 1 מוזכר | 2 בשלושת הראשונים | 3 מומלץ במפורש
 * positionBasis: 'list' — המיקום נקבע לפי מספר הפריט ברשימה, מדויק
 *                'rivals' — נגזר ממתחרים מוכרים בלבד, עלול להיות אופטימי
 */
function analyzeCell(text, client, rivals) {
  if (text === null || text === undefined || String(text).trim() === '') {
    return {
      status: null, position: null, positionBasis: null,
      rivalsFound: [], recommendHint: false, reason: 'no_text'
    };
  }

  const clientForms = N.expand(client.name, client.variants);
  const clientAt = N.findFirst(text, clientForms);

  // מיקומי כל המתחרים
  const rivalHits = [];
  const rivalForms = [];
  for (const r of (rivals || [])) {
    const forms = N.expand(r.name, r.variants);
    for (const f of forms) rivalForms.push(f);
    const at = N.findFirst(text, forms);
    if (at !== -1) rivalHits.push({ name: r.name, at });
  }

  const rivalsFound = rivalHits.sort((a, b) => a.at - b.at).map(r => r.name);

  if (clientAt === -1) {
    return {
      status: 0, position: null, positionBasis: null,
      rivalsFound, recommendHint: false, reason: 'not_found'
    };
  }

  // מיקום: קודם כל לפי מבנה רשימה, שסופר גם עסקים שלא הוגדרו כמתחרים.
  // רק אם אין רשימה — נופלים לספירת המתחרים המוכרים.
  let position = null;
  let positionBasis = null;
  const items = listItems(text);
  if (items.length >= 3) {
    const idx = items.findIndex(it => N.findFirst(it, clientForms) !== -1);
    if (idx !== -1) { position = idx + 1; positionBasis = 'list'; }
  }
  if (position === null) {
    position = rivalHits.filter(r => r.at < clientAt).length + 1;
    positionBasis = 'rivals';
  }

  const recommendHint = recommendsClient(text, clientForms, rivalForms);

  let status;
  if (position === 1 && recommendHint) status = 3;
  else if (position <= 3) status = 2;
  else status = 1;

  return { status, position, positionBasis, rivalsFound, recommendHint, reason: 'found' };
}

/**
 * חישוב הציון על אוסף תוצאות.
 * תאים עם status === null אינם נספרים במכנה.
 */
function score(results) {
  let measured = 0, appear = 0, top3 = 0, direct = 0;
  const allRivals = [];
  const allSources = [];
  const gaps = {};

  for (const r of results) {
    // מסננים גם כאן ולא רק בזמן האיסוף, כדי שריצות שכבר נשמרו
    // לפני שהסינון הורחב יתוקנו בדוח בלי להריץ אותן מחדש.
    for (const src of (r.sources || [])) { if (!N.isInfra(src)) allSources.push(src); }
    for (const rv of (r.rivals || [])) allRivals.push(rv);

    if (r.status === null || r.status === undefined) continue;
    measured++;
    if (r.status >= 1) appear++;
    if (r.status >= 2) top3++;
    if (r.status === 3) direct++;

    if (!gaps[r.questionText]) gaps[r.questionText] = { hits: 0, measured: 0 };
    gaps[r.questionText].measured++;
    if (r.status >= 1) gaps[r.questionText].hits++;
  }

  const pAppear = measured ? appear / measured : 0;
  const pTop3 = measured ? top3 / measured : 0;
  const pDirect = measured ? direct / measured : 0;
  const total = Math.round(100 * (0.4 * pAppear + 0.3 * pTop3 + 0.3 * pDirect));

  const rivalTally = N.tally(allRivals);
  const sourceTally = N.tally(allSources);
  const rivalTotal = rivalTally.reduce((s, x) => s + x[1], 0);

  const gapList = Object.keys(gaps).filter(q => gaps[q].measured > 0 && gaps[q].hits === 0);

  return {
    measured, appear, top3, direct,
    pAppear, pTop3, pDirect, score: total,
    rivalTally, sourceTally, rivalTotal,
    multiplier: appear > 0 ? rivalTotal / appear : null,
    gaps: gapList
  };
}

module.exports = { analyzeCell, score, listItems, sentences, RECOMMEND_HINTS };
