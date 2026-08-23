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

/**
 * מחשב status לתא בודד.
 * text  — טקסט התשובה
 * client — { name, variants }
 * rivals — [{ name, variants }]
 *
 * מחזיר: { status, position, rivalsFound, recommendHint }
 * status: 0 לא מופיע | 1 מוזכר | 2 בשלושת הראשונים | 3 מומלץ במפורש
 */
function analyzeCell(text, client, rivals) {
  if (text === null || text === undefined || String(text).trim() === '') {
    return { status: null, position: null, rivalsFound: [], recommendHint: false, reason: 'no_text' };
  }

  const clientForms = N.expand(client.name, client.variants);
  const clientAt = N.findFirst(text, clientForms);

  // מיקומי כל המתחרים
  const rivalHits = [];
  for (const r of (rivals || [])) {
    const at = N.findFirst(text, N.expand(r.name, r.variants));
    if (at !== -1) rivalHits.push({ name: r.name, at });
  }

  const rivalsFound = rivalHits.sort((a, b) => a.at - b.at).map(r => r.name);

  if (clientAt === -1) {
    return { status: 0, position: null, rivalsFound, recommendHint: false, reason: 'not_found' };
  }

  // דירוג: כמה שמות מוכרים הופיעו לפני הלקוח
  const before = rivalHits.filter(r => r.at < clientAt).length;
  const position = before + 1;

  // רמז להמלצה מפורשת — נבדק רק בסביבת האזכור
  const norm = N.norm(text);
  const clientNormAt = norm.indexOf(N.norm(client.name).split(' ')[0]);
  const windowStart = Math.max(0, (clientNormAt === -1 ? clientAt : clientNormAt) - 120);
  const around = norm.slice(windowStart, windowStart + 320);
  const recommendHint = RECOMMEND_HINTS.some(h => around.includes(N.norm(h)));

  let status;
  if (position === 1 && recommendHint) status = 3;
  else if (position <= 3) status = 2;
  else status = 1;

  return { status, position, rivalsFound, recommendHint, reason: 'found' };
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
    for (const src of (r.sources || [])) allSources.push(src);
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

module.exports = { analyzeCell, score, RECOMMEND_HINTS };
