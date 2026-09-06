import { formatILS } from '@/lib/format';

/**
 * אזהרה (לא חסימה) כשהתשלום גדול מהחוב או כשאין חוב. תשלום כזה נרשם
 * כיתרת זכות — לגיטימי (תשלום מראש), אבל לא בטעות.
 */
export function overpaymentWarning(amount: number, balance: number): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (balance <= 0) return `לתלמידה אין חוב פתוח. אחרי התשלום תהיה לה יתרת זכות של ${formatILS(amount - balance)}.`;
  if (amount > balance) return `הסכום גדול מהחוב ב-${formatILS(amount - balance)}. העודף יירשם כיתרת זכות.`;
  return null;
}
