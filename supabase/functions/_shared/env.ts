/** קריאת משתני סביבה. אין מפתחות בקוד, ואין מפתחות בפרונט. */
export function env(key: string): string | undefined {
  return Deno.env.get(key);
}

export function requireEnv(key: string): string {
  const v = Deno.env.get(key);
  if (!v) throw new Error(`חסר משתנה סביבה: ${key}`);
  return v;
}

/** ברירת המחדל היא dry-run: בלי הדגל הזה שום הודעה לא יוצאת החוצה. */
export const WA_DRY_RUN = (Deno.env.get('WA_DRY_RUN') ?? 'true') !== 'false';
export const AI_DRY_RUN = (Deno.env.get('AI_DRY_RUN') ?? 'true') !== 'false';

/**
 * תקרת זמן קשיחה לקריאה למודל, במילישניות.
 *
 * הניה שולחת פקודה ומחכה. קריאה שלא חוזרת היא סוכן תקוע בשקט, וזה
 * גרוע יותר מתשובה שלילית: היא לא יודעת אם ההוצאה נרשמה. מעל הסף
 * הזה מפסיקים לחכות ועונים לה.
 *
 * 8 שניות: המדידה על 30 פקודות אמיתיות נותנת ~2-4 שניות לקריאה,
 * כלומר הסף אינו חותך ריצה תקינה אלא רק תלייה.
 */
export const AI_TIMEOUT_MS = Number(Deno.env.get('AI_TIMEOUT_MS') ?? '8000');
