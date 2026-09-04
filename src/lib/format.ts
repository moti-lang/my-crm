import { format, parseISO } from 'date-fns';

/** הפורמט היחיד לכסף במערכת. אין חישוב או עיצוב כספי ב-JSX. */
export function formatILS(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : (value ?? 0);
  if (!Number.isFinite(n)) return '₪0';
  const rounded = Math.round(n);
  // המינוס לפני סימן השקל, וסימן LRM לפניו: בלי זה פסקה RTL מציגה
  // '₪23,700-' — המינוס קופץ לסוף. נבדק בצילום מסך של 390px.
  const text = `₪${Math.abs(rounded).toLocaleString('he-IL')}`;
  return rounded < 0 ? `\u200E-${text}` : text;
}

/** dd/MM/yyyy — פורמט התצוגה היחיד לתאריכים. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? parseISO(value) : value;
  return Number.isNaN(d.getTime()) ? '—' : format(d, 'dd/MM/yyyy');
}

/** 972521234567 → 052-123-4567 */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '—';
  const d = phone.replace(/\D/g, '');
  const local = d.startsWith('972') ? `0${d.slice(3)}` : d;
  return local.length === 10 ? `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}` : local;
}

/** כל טלפון נשמר מנורמל: 972XXXXXXXXX, בלי + ובלי מקפים. */
export function normalizePhone(input: string): string {
  const d = input.replace(/\D/g, '');
  if (d.startsWith('972')) return d;
  if (d.startsWith('0')) return `972${d.slice(1)}`;
  return d;
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'] as const;
export function formatWeekdays(days: number[] | null | undefined): string {
  if (!days?.length) return '—';
  return days.map((d) => WEEKDAYS[d] ?? '?').join(', ');
}
