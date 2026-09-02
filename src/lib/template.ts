/**
 * מנוע הרכבת ההודעות (סעיף 2.6 באפיון).
 * משתנה שאין לו ערך מוחלף במחרוזת ריקה, ורווחים כפולים מנוקים —
 * כדי שהודעה עם שדה חסר לא תיראה שבורה אצל ההורה.
 *
 * ללא תלויות בכוונה: אותה לוגיקה תידרש גם ב-Edge Functions בסבב 5.
 */
export const TEMPLATE_VARIABLES = [
  'student_name', 'parent_name', 'branch', 'balance', 'total', 'paid',
  'date', 'time', 'lesson_date', 'link',
] as const;

export type TemplateVars = Partial<Record<(typeof TEMPLATE_VARIABLES)[number], string>>;

export function renderTemplate(body: string, vars: TemplateVars): string {
  return body
    .replace(/\{(\w+)\}/g, (_match, key: string) => vars[key as keyof TemplateVars] ?? '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.!?])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** אילו משתנים מופיעים בתבנית — לתצוגת העורך. */
export function usedVariables(body: string): string[] {
  return [...new Set([...body.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string))];
}
