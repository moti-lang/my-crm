import type { ParsedCommand } from './command-schema.ts';

/**
 * בדיקות ההרשאה לפקודות וואטסאפ (סעיף 4.3.3).
 *
 * פונקציה טהורה: אין לה מסד, אין לה רשת, ואין לה תופעות לוואי.
 * זה מה שמאפשר לבדוק את כל מטריצת ההרשאות בלי סביבה.
 */

export type AuthorizedNumber = {
  phone: string;
  label: string;
  scope: string;            // 'all' | 'finance' | 'branch'
  branch_id: string | null;
  branch_name?: string | null;
  can_delete: boolean;
  is_active: boolean;
};

export type Verdict =
  | { allowed: true }
  | { allowed: false; reason: string; message: string };

/** כוונות שנחשבות פעולה כספית — המותרות ל-scope='finance'. */
const FINANCE_INTENTS = new Set(['expense', 'income', 'payment', 'query']);

/** כוונות קריאה בלבד. אינן משנות דבר ולכן אינן דורשות אישור. */
export const READ_ONLY_INTENTS = new Set(['query']);

/** האם הפקודה היא מחיקה. נבדק גם לפי intent וגם לפי הערך שהמודל החזיר. */
export function isDeletion(command: ParsedCommand): boolean {
  if (command.intent === 'update_student') {
    const value = String(command.fields.value ?? '').toLowerCase();
    const field = String(command.fields.field ?? '').toLowerCase();
    if (value === 'deleted' || value === 'delete' || field === 'delete') return true;
  }
  return false;
}

/** שם הסניף שהפקודה נוגעת בו, אם יש. */
export function targetBranch(command: ParsedCommand): string | null {
  const raw = command.fields.branch;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

/**
 * מכריע אם המספר הזה רשאי לבצע את הפקודה הזו.
 * ההודעה מנוסחת לשליחה כמות שהיא — בעברית, בלי ז'רגון טכני.
 */
export function authorizeCommand(caller: AuthorizedNumber, command: ParsedCommand): Verdict {
  if (!caller.is_active) {
    return { allowed: false, reason: 'inactive', message: 'המספר הזה אינו פעיל במערכת.' };
  }

  if (isDeletion(command) && !caller.can_delete) {
    return {
      allowed: false,
      reason: 'delete_denied',
      message: 'מחיקה אינה מורשית מהמספר הזה. אפשר לבצע אותה מהמערכת.',
    };
  }

  if (caller.scope === 'finance' && !FINANCE_INTENTS.has(command.intent)) {
    return {
      allowed: false,
      reason: 'scope_finance',
      message: 'מהמספר הזה אפשר לרשום הוצאות, הכנסות ותשלומים, ולשאול שאלות. פעולה אחרת צריכה להיעשות מהמערכת.',
    };
  }

  if (caller.scope === 'branch') {
    if (!caller.branch_id) {
      return {
        allowed: false,
        reason: 'branch_unassigned',
        message: 'המספר הזה מוגדר לסניף אך לא שויך לאף סניף. פני לניהול.',
      };
    }
    const target = targetBranch(command);
    // פעולה שאינה נוקבת בסניף מיוחסת לסניף של השולחת — זה המקרה הרגיל.
    if (target && caller.branch_name && target !== caller.branch_name) {
      return {
        allowed: false,
        reason: 'wrong_branch',
        message: `מהמספר הזה אפשר לפעול רק בסניף ${caller.branch_name}.`,
      };
    }
  }

  return { allowed: true };
}

/** טקסטים שמסמנים ניסיון פקודה ממספר לא מוכר (סעיף 4.2). */
const COMMAND_MARKERS = ['תעדכן', 'תעדכני', 'תרשום', 'תרשמי', 'הוצאה', 'תמחק', 'תמחקי'];

export function looksLikeCommand(text: string): boolean {
  const t = (text ?? '').trim();
  return COMMAND_MARKERS.some((m) => t.includes(m));
}
