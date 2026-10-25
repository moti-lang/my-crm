/**
 * מנוע הרכבת ההודעות (סעיף 2.6 באפיון).
 * משתנה שאין לו ערך מוחלף במחרוזת ריקה, ורווחים כפולים מנוקים —
 * כדי שהודעה עם שדה חסר לא תיראה שבורה אצל ההורה.
 *
 * ללא תלויות בכוונה: אותה לוגיקה תידרש גם ב-Edge Functions בסבב 5.
 */
export const TEMPLATE_VARIABLES = [
  'student_name', 'parent_name', 'supervisor_name', 'branch', 'balance', 'total', 'paid',
  'date', 'time', 'lesson_date', 'link',
  'reported', 'total', 'income', 'debtors', 'debt', 'new_leads', 'unanswered', 'enrollment', 'enrollment_overdue',
] as const;

export type TemplateVars = Partial<Record<(typeof TEMPLATE_VARIABLES)[number], string>>;

/** אותם משתנים, בשמות בעברית — כמו שהבעלים כותבת אותם: {שם ההורה} = {parent_name}. */
export const HEBREW_VARIABLES: Record<string, (typeof TEMPLATE_VARIABLES)[number]> = {
  'שם ההורה': 'parent_name',
  'שם התלמידה': 'student_name',
  'סניף': 'branch',
  'יתרה': 'balance',
  'שולם': 'paid',
  'סכום כולל': 'total',
  'תאריך': 'date',
};
const HEBREW_PATTERN = new RegExp(`\\{(${Object.keys(HEBREW_VARIABLES).join('|')})\\}`, 'g');

export function renderTemplate(body: string, vars: TemplateVars): string {
  return body
    .replace(HEBREW_PATTERN, (_match, he: string) => vars[HEBREW_VARIABLES[he] as keyof TemplateVars] ?? '')
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
