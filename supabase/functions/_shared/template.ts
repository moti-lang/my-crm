/**
 * מנוע הרכבת ההודעות (סעיף 2.6 באפיון).
 *
 * ⚠️ עותק של src/lib/template.ts. Supabase אורזת כל פונקציה מתיקייתה,
 * ולכן אי אפשר לייבא מ-src/. הכפילות מכוונת ומכוסה בבדיקה
 * (supabase/tests/template-parity.test.mjs) שמריצה את שתי המימושים
 * על אותם קלטים ומוודאת פלט זהה. אם אחד ישתנה בלי השני — היא תיפול.
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

export function usedVariables(body: string): string[] {
  return [...new Set([...body.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string))];
}
