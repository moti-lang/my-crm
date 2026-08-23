'use strict';

/**
 * בניית ה-JSON לכלי הידני. לוגיקה טהורה, בלי מסד נתונים —
 * כדי שאפשר יהיה לבדוק אותה בלי דפדפן ובלי DB.
 *
 * הכלל שנשמר כאן: תא שלא נמדד יוצא כ-status: null עם measured: false.
 * אסור להמיר אותו ל-0. "לא נמדד" ו"לא מופיע" הם שני דברים שונים,
 * והמרה כזאת מוכרת ללקוח ציון שקרי.
 */

const ENGINES = ['chatgpt', 'gemini', 'google_aio'];

function buildExport(client, rows) {
  const byQ = {};
  for (const r of (rows || [])) {
    if (!byQ[r.questionText]) byQ[r.questionText] = {};
    byQ[r.questionText][r.engine] = r;
  }

  // כל השאלות של הלקוח, גם אלה שאין להן שום תוצאה —
  // שאלה חסרה בייצוא נראית כאילו לא נשאלה מעולם.
  const questionTexts = (client.questions || []).map(q => (typeof q === 'string' ? q : q.text));
  for (const q of Object.keys(byQ)) {
    if (questionTexts.indexOf(q) === -1) questionTexts.push(q);
  }

  return {
    biz: client.name,
    trade: client.trade,
    city: client.city,
    city2: client.city2 || '',
    extra: client.extra || '',
    competitors: (client.competitors || []).map(c => c.name),
    questions: questionTexts.map(q => ({
      text: q,
      cells: ENGINES.map(e => {
        const r = byQ[q] && byQ[q][e];
        const measured = !!r && r.status !== null && r.status !== undefined;
        return {
          status: measured ? r.status : null,
          measured,
          rivals: r ? (r.rivals || []).join(', ') : '',
          source: r ? (r.sources || [])[0] || '' : ''
        };
      })
    }))
  };
}

module.exports = { buildExport, ENGINES };
