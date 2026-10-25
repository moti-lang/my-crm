/**
 * מי תקבל מייל — אותם כללים כמו בשרת (supabase/functions/_shared/email-core.ts), כדי שהמסך
 * יסמן מראש מי לא תקבל ולמה. ההחלטה עצמה בשרת; כאן תצוגה. הבדיקה email-parity משווה ביניהם.
 */
import { HEBREW_VARIABLES } from './template';

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const normEmail = (e: string | null | undefined) => (e ?? '').trim().toLowerCase();

export type SkipReason = 'no_email' | 'no_consent' | 'unsubscribed' | 'duplicate';
export const SKIP_LABEL: Record<SkipReason, string> = {
  no_email: 'אין כתובת מייל',
  no_consent: 'לא אישרה תפוצה במייל',
  unsubscribed: 'הוסרה מהתפוצה',
  duplicate: 'אותה כתובת כבר ברשימה',
};

const PERSONAL = ['student_name', 'balance', 'paid', 'total'];
export function isPersonal(...texts: string[]): boolean {
  const all = texts.join('\n');
  const he = Object.entries(HEBREW_VARIABLES).filter(([, en]) => PERSONAL.includes(en)).map(([h]) => `{${h}}`);
  return PERSONAL.some((v) => all.includes(`{${v}}`)) || he.some((v) => all.includes(v));
}

/** למה התלמידה הזו לא תקבל (או null — תקבל). */
export function exclusionOf(s: { email: string | null; mailing_consent: boolean | null }, suppressed: Map<string, string> | Set<string>): Exclude<SkipReason, 'duplicate'> | null {
  const to = normEmail(s.email);
  if (!to || !EMAIL_RE.test(to)) return 'no_email';
  if (s.mailing_consent !== true) return 'no_consent';
  if (suppressed.has(to)) return 'unsubscribed';
  return null;
}
