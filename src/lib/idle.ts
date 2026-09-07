/**
 * יציאה אוטומטית אחרי חוסר פעילות — מכונת מצבים טהורה, בלי דפדפן,
 * כדי שאפשר לבדוק אותה בבדיקה רגילה.
 *
 * 30 דקות בלי פעילות → יציאה. דקה לפני: אזהרה עם ספירה לאחור, כדי
 * שמי שבאמצע הזנת נתונים לא תאבד אותם. מסך האחראית (/a/:token) אינו
 * כפוף: אין בו מידע רגיש והוא חייב לעבוד בלי חיכוך.
 */
export const IDLE_LIMIT_MS = 30 * 60_000;
export const IDLE_WARN_MS = 60_000;

export type IdleState = 'active' | 'warning' | 'expired';

export function idleState(lastActivity: number, now: number): IdleState {
  const idle = now - lastActivity;
  if (idle >= IDLE_LIMIT_MS) return 'expired';
  if (idle >= IDLE_LIMIT_MS - IDLE_WARN_MS) return 'warning';
  return 'active';
}

/** שניות שנותרו עד היציאה, לספירה לאחור באזהרה. */
export function secondsLeft(lastActivity: number, now: number): number {
  return Math.max(0, Math.ceil((IDLE_LIMIT_MS - (now - lastActivity)) / 1000));
}

/** המסכים הציבוריים (האחראית, ההורה) — לא כפופים ליציאה האוטומטית. */
export function isIdleExempt(pathname: string): boolean {
  return /^\/(a|pay)\//.test(pathname);
}

/** אירועי דפדפן שנחשבים פעילות. */
export const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll', 'pointermove'] as const;
