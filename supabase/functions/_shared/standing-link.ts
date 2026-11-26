/**
 * "חיבור הוראת קבע מ-SUMIT": ההוראות של לקוח ב-SUMIT, במבנה שהמסך מציג — סכום, מצב, החיוב הבא
 * והאחרון, וכמה נותרו (לפי SUMIT). רק שדות של ההוראה עצמה; אין כאן נתוני כרטיס.
 * מה אי אפשר לחבר (בוטלה / הסתיימה / בלי תאריכים) — מוצג עם הסיבה, לא מוסתר.
 */
import type { StandingItem } from './standing.ts';

export type LinkableItem = {
  id: number; status: number | null; statusLabel: string; amount: number | null;
  next: string | null; prev: string | null; last: string | null; remaining: number | null;
  linkable: boolean; reason: string | null;
};

const LABEL: Record<number, string> = { 0: 'פעילה', 1: 'בוטלה', 3: 'הושבתה אחרי כישלון', 9: 'הסתיימה', 11: 'בתקופת חסד',
  12: 'ממתינה לחיוב ראשון', 13: 'בוטלה על ידי הלקוחה', 14: 'ממתינה לניסיון חוזר' };

const day = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : null);
const months = (from: string, to: string) => {
  const [fy, fm] = from.split('-').map(Number), [ty, tm] = to.split('-').map(Number);
  return (ty! - fy!) * 12 + (tm! - fm!);
};

export function linkableItems(list: StandingItem[], alreadyLinked: number[]): LinkableItem[] {
  return list.filter((x) => !alreadyLinked.includes(Number(x.ID))).map((x) => {
    const next = day(x.Date_NextBilling), last = day(x.Date_Last ?? null), prev = day(x.Date_PreviousBilling);
    const status = x.Status ?? null;
    const remaining = next && last ? months(next, last) + 1 : null;
    const reason = status === 1 || status === 13 ? 'ההוראה בוטלה ב-SUMIT'
      : status === 9 ? 'ההוראה הסתיימה'
      : !next || !last ? 'אין ב-SUMIT חיוב הבא / אחרון — אי אפשר לדעת כמה נותרו'
      : !x.UnitPrice || x.UnitPrice <= 0 ? 'אין סכום להוראה'
      : null;
    return { id: Number(x.ID), status, statusLabel: status === null ? 'לא ידוע' : LABEL[status] ?? `קוד ${status}`,
             amount: x.UnitPrice ?? null, next, prev, last, remaining, linkable: reason === null, reason };
  });
}
