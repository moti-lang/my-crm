'use strict';

/**
 * הצעת שאלות ללקוח חדש.
 *
 * למה זה קיים: כתיבת עשר שאלות מאפס לכל עסק היא העבודה הידנית האחרונה
 * שנשארה, והיא גם חוזרת על עצמה — אותן זוויות בדיוק, רק עם תחום ועיר אחרים.
 *
 * זה מחולל תבניות ולא מודל שפה: אין מפתח API, אין עלות, אין תלות ברשת,
 * והתוצאה צפויה. המחיר הוא שהניסוח לא תמיד מושלם — ולכן זו הצעה שנכנסת
 * לתיבת העריכה, לא רשימה סגורה.
 *
 * המבנה זהה לזה של הכלי הידני (manual-tool/index.html), בכוונה: אותן עשר
 * זוויות, כדי שמדידה מהכלי הידני ומדידה מהמנוע יהיו ברות השוואה.
 */

/**
 * מילים שפותחות שם פעולה ("קניית דגים טריים").
 * בחלק מהשאלות צריך את מה שאחריהן בלבד — "דגים טריים" — אחרת יוצא
 * "אני מחפש קניית דגים טריים", וזה לא עברית.
 */
const ACTION_WORDS = [
  'קניית', 'רכישת', 'הזמנת', 'שכירת', 'השכרת', 'מכירת', 'תיקון', 'תיקוני',
  'שירותי', 'שירות', 'ייעוץ', 'טיפול', 'טיפולי', 'לימוד', 'לימודי',
  'הובלת', 'הובלות', 'משלוח', 'משלוחי', 'התקנת', 'התקנות', 'עיצוב', 'ניקיון'
];

/** "קניית דגים טריים" → "דגים טריים". תחום שאינו שם פעולה חוזר כמו שהוא. */
function bareTrade(trade) {
  const parts = String(trade || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1 && ACTION_WORDS.indexOf(parts[0]) !== -1) return parts.slice(1).join(' ');
  return parts.join(' ');
}

const MAX = 10;

/**
 * בונה רשימת שאלות מהפרטים שהוזנו.
 * החזרה היא תמיד מערך — ריק כשאין מספיק מידע לבנות ממנו שאלה.
 */
function suggest(client) {
  const c = client || {};
  const trade = String(c.trade || '').trim();
  const city  = String(c.city  || '').trim();
  const city2 = String(c.city2 || '').trim();
  const extra = String(c.extra || '').trim();
  if (!trade || !city) return [];

  const bare = bareTrade(trade);
  const out = [
    `מי הכי מומלץ ל${trade} ב${city}?`,
    `תמליץ לי על ${trade} ב${city}`,
    `אני מחפש ${bare} ב${city}, על מי אתה ממליץ?`,
    `תן לי 5 המלצות ל${trade} ב${city}`,
    `${bare} ב${city} עם ביקורות טובות — מה ההמלצות?`,
    `מה המחירים של ${bare} ב${city}?`,
    `איך בוחרים ${bare} ב${city}?`,
    `מה ההבדלים בין האפשרויות ל${trade} ב${city}?`
  ];

  // שתי השאלות האחרונות תמיד קיימות, גם בלי ייחוד ובלי עיר שנייה:
  // מערך של עשר שאלות קבוע הוא מה שמאפשר להשוות חודש לחודש ולקוח ללקוח.
  out.push(extra ? `${bare} ${extra} ב${city} — מה ההמלצות?`
                 : `${bare} ב${city} עם שירות מהיר — מה ההמלצות?`);
  out.push(city2 ? `מה ההמלצות ל${trade} באזור ${city} ו${city2}?`
                 : `מה ההמלצות ל${trade} באזור ${city} והסביבה?`);

  // כפילויות אפשריות כשהתחום כבר מכיל את מה שמייחד
  const seen = {}, uniq = [];
  for (const q of out) {
    const key = q.replace(/\s+/g, ' ').trim();
    if (seen[key]) continue;
    seen[key] = true;
    uniq.push(key);
  }
  return uniq.slice(0, MAX);
}

module.exports = { suggest, bareTrade, ACTION_WORDS, MAX };
