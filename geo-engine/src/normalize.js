'use strict';

/**
 * נרמול טקסט עברי לצורך התאמת שמות עסקים.
 * הבעיה: "גולד פיש", "גולדפיש", "גולד-פיש", "וגולדפיש" ו"ל'גולד פיש'"
 * הם אותו עסק, אבל חמש מחרוזות שונות.
 */

// ניקוד וטעמים
const NIQQUD = /[\u0591-\u05C7]/g;
// גרש וגרשיים עבריים + מקבילות לועזיות
const QUOTES = /['"׳״`’‘“”]/g;
// סימני פיסוק שמפרידים מילים
const PUNCT = /[.,;:!?()\[\]{}<>|\\\/–—\-_*#״]/g;

/** נרמול בסיסי: מוריד ניקוד, גרשיים ופיסוק, מאחד רווחים */
function norm(s) {
  if (!s) return '';
  return String(s)
    .replace(NIQQUD, '')
    .replace(QUOTES, '')
    .replace(PUNCT, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** נרמול "צמוד" — מוריד גם רווחים. "גולד פיש" === "גולדפיש" */
function tight(s) {
  return norm(s).replace(/\s+/g, '');
}

/** אותיות שימוש שעלולות להידבק לתחילת שם: וכלבמשה */
const PREFIXES = ['ו', 'ה', 'ב', 'ל', 'מ', 'ש', 'כ', 'וה', 'וב', 'ול', 'ומ', 'שה', 'כש'];

/**
 * מייצר את כל הצורות שבהן שם עשוי להופיע בטקסט.
 * מקבל שם + וריאציות שהוזנו ידנית, ומחזיר סט מנורמל.
 */
function expand(name, variants) {
  const base = [name].concat(variants || []).filter(Boolean);
  const out = new Set();
  for (const b of base) {
    const n = norm(b);
    const t = tight(b);
    if (!n) continue;
    out.add(n);
    out.add(t);
    for (const p of PREFIXES) {
      out.add(p + n);
      out.add(p + t);
    }
  }
  return Array.from(out).filter(x => x.length >= 2);
}

/**
 * מחפש את המופע הראשון של אחת מהצורות בטקסט.
 * מחזיר את המיקום בתווים, או -1.
 * מחפש גם בגרסה עם רווחים וגם בגרסה הצמודה, כדי לתפוס "גולדפיש" כשמחפשים "גולד פיש".
 */
function findFirst(text, forms) {
  const hay = norm(text);
  const hayTight = tight(text);
  let best = -1;
  for (const f of forms) {
    let i = hay.indexOf(f);
    if (i === -1) {
      const j = hayTight.indexOf(f.replace(/\s+/g, ''));
      if (j !== -1) {
        // המרה גסה למיקום יחסי — מספיק לצורך דירוג בין שמות
        i = Math.round((j / Math.max(hayTight.length, 1)) * hay.length);
      }
    }
    if (i !== -1 && (best === -1 || i < best)) best = i;
  }
  return best;
}

/** האם השם מופיע בטקסט בכלל */
function mentions(text, name, variants) {
  return findFirst(text, expand(name, variants)) !== -1;
}

/** חילוץ דומיינים מרשימת קישורים */
function domainsOf(urls) {
  const out = [];
  for (const u of urls || []) {
    try {
      const h = new URL(u).hostname.replace(/^www\./, '');
      if (h && !/^(chatgpt|openai|gemini|google|gstatic|googleusercontent)\./.test(h)) out.push(h);
    } catch (e) { /* לא URL תקין — מדלגים */ }
  }
  return out;
}

/** ספירה לפי מפתח, ממוין מהגבוה לנמוך */
function tally(list) {
  const m = {};
  for (const x of list) { if (x) m[x] = (m[x] || 0) + 1; }
  return Object.keys(m).map(k => [k, m[k]]).sort((a, b) => b[1] - a[1]);
}

module.exports = { norm, tight, expand, findFirst, mentions, domainsOf, tally };
