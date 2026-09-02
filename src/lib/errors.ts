/**
 * הודעות שגיאה למשתמשת — בעברית תמיד.
 * הודעות PostgREST/Supabase גולמיות ("JSON object requested, multiple
 * (or no) rows returned") לא אמורות להגיע למסך.
 */
const PATTERNS: [RegExp, string][] = [
  [/multiple \(or no\) rows returned/i, 'הרשומה לא נמצאה.'],
  [/row-level security|permission denied|insufficient/i, 'אין לך הרשאה לצפות בנתונים האלה.'],
  [/duplicate key|already exists/i, 'הרשומה כבר קיימת.'],
  [/violates foreign key/i, 'לא ניתן לשמור — יש קישור לרשומה שאינה קיימת.'],
  [/violates check constraint/i, 'אחד השדות אינו תקין.'],
  [/failed to fetch|network|fetch failed/i, 'אין חיבור לשרת. בדקי את החיבור ונסי שוב.'],
  [/jwt|token|not authenticated/i, 'ההתחברות פגה. יש להתחבר מחדש.'],
];

export function humanError(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  for (const [pattern, message] of PATTERNS) {
    if (pattern.test(raw)) return message;
  }
  return 'משהו השתבש בטעינת הנתונים.';
}

/** הפרטים הטכניים — לקונסול ולדיווח תקלות, לא למסך. */
export function logError(context: string, error: unknown): void {
  console.error(`[${context}]`, error);
}
