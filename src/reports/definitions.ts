/**
 * הגדרות הדוחות — טהורות, בלי React ובלי רשת.
 *
 * כל דוח: מזהה, כותרת, עמודות לייצוא (ערך גולמי — מספר נשאר מספר),
 * ותצוגה למסך/PDF. הדף ב-Reports.tsx רק מציג; הבדיקה
 * reports-export.test.mjs מייצאת כל דוח מכאן ומוודאת שהקובץ שחוזר
 * זהה לשורות.
 */
import type { Column } from '@/lib/export-core';
import { formatILS, formatDate, formatPercent } from '@/lib/format';

export type ReportId =
  | 'pnl' | 'branches' | 'collection' | 'attendance' | 'churn' | 'productions' | 'leads';

export type ReportDef<T> = {
  id: ReportId;
  title: string;
  subtitle: string;
  columns: Column<T>[];
  /** ערך מעוצב למסך ול-PDF. מספר → לפי סוג העמודה. */
  display: (row: T, col: Column<T>) => string;
  /** גרף: ציר X ושדות למספרים */
  chart: { xKey: string; series: { key: string; label: string; color: string }[] };
  toChart: (rows: T[]) => Record<string, string | number>[];
};

const money = (v: unknown) => formatILS(typeof v === 'number' ? v : Number(v ?? 0));
const num = (v: unknown) => (v === null || v === undefined ? '—' : String(v));
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

/** חודש yyyy-mm-dd → MM/yyyy */
export const monthLabel = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const [y, m] = iso.slice(0, 7).split('-');
  return `${m}/${y}`;
};

// ─────────── 1. רווח והפסד לפי חודש ───────────
export type PnlRow = {
  month: string | null; income_students: number | null; income_other: number | null;
  expenses: number | null; expenses_branch: number | null; expenses_general: number | null;
  expenses_production: number | null; profit: number | null;
};
export const PNL: ReportDef<PnlRow> = {
  id: 'pnl', title: 'רווח והפסד', subtitle: 'לפי חודש, לעונה הנוכחית',
  columns: [
    { label: 'חודש', value: (r) => monthLabel(r.month) },
    { label: 'הכנסות מתלמידות', value: (r) => n(r.income_students), numeric: true },
    { label: 'הכנסות אחרות', value: (r) => n(r.income_other), numeric: true },
    { label: 'הוצאות סניפים', value: (r) => n(r.expenses_branch), numeric: true },
    { label: 'הוצאות הנהלה', value: (r) => n(r.expenses_general), numeric: true },
    { label: 'הוצאות הפקות', value: (r) => n(r.expenses_production), numeric: true },
    { label: 'סך הוצאות', value: (r) => n(r.expenses), numeric: true },
    { label: 'רווח', value: (r) => n(r.profit), numeric: true },
  ],
  display: (r, c) => (c.numeric ? money(c.value(r)) : String(c.value(r) ?? '—')),
  chart: { xKey: 'חודש', series: [
    { key: 'הכנסות', label: 'הכנסות', color: 'var(--ok)' },
    { key: 'הוצאות', label: 'הוצאות', color: 'var(--bad)' },
  ] },
  toChart: (rows) => rows.map((r) => ({
    'חודש': monthLabel(r.month), 'הכנסות': n(r.income_students) + n(r.income_other), 'הוצאות': n(r.expenses),
  })),
};

// ─────────── 2. רווחיות לפי סניף ───────────
export type BranchProfitRow = {
  name: string | null; active_students: number | null; income_students: number | null;
  income_other: number | null; expenses: number | null; open_debt: number | null;
  profit_before: number | null; allocated: number | null; profit_after: number | null;
};
export const BRANCHES: ReportDef<BranchProfitRow> = {
  id: 'branches', title: 'רווחיות לפי סניף', subtitle: 'לפני ואחרי הקצאת הוצאות הנהלה',
  columns: [
    { label: 'סניף', value: (r) => r.name },
    { label: 'תלמידות פעילות', value: (r) => n(r.active_students), numeric: true },
    { label: 'הכנסות', value: (r) => n(r.income_students) + n(r.income_other), numeric: true },
    { label: 'הוצאות', value: (r) => n(r.expenses), numeric: true },
    { label: 'רווח לפני הקצאה', value: (r) => n(r.profit_before), numeric: true },
    { label: 'הקצאת הנהלה', value: (r) => n(r.allocated), numeric: true },
    { label: 'רווח אחרי הקצאה', value: (r) => n(r.profit_after), numeric: true },
    { label: 'חוב פתוח', value: (r) => n(r.open_debt), numeric: true },
  ],
  display: (r, c) => (c.label === 'תלמידות פעילות' ? num(c.value(r)) : c.numeric ? money(c.value(r)) : String(c.value(r) ?? '—')),
  chart: { xKey: 'סניף', series: [
    { key: 'לפני הקצאה', label: 'לפני הקצאה', color: 'var(--plum)' },
    { key: 'אחרי הקצאה', label: 'אחרי הקצאה', color: 'var(--rose)' },
  ] },
  toChart: (rows) => rows.map((r) => ({ 'סניף': r.name ?? '', 'לפני הקצאה': n(r.profit_before), 'אחרי הקצאה': n(r.profit_after) })),
};

// ─────────── 3. גבייה ───────────
export type DebtorRow = {
  full_name: string | null; branch_name: string | null; parent_name: string | null;
  parent_phone: string | null; due: number | null; paid: number | null; balance: number | null;
  last_paid_on: string | null; days_outstanding: number | null; aging_bucket: number | null;
};
export const AGING_LABEL: Record<number, string> = { 0: 'עד 30 יום', 30: '30–59 יום', 60: '60–89 יום', 90: '90 יום ומעלה' };
export const COLLECTION: ReportDef<DebtorRow> = {
  id: 'collection', title: 'גבייה', subtitle: 'חייבות לפי גיל החוב',
  columns: [
    { label: 'תלמידה', value: (r) => r.full_name },
    { label: 'סניף', value: (r) => r.branch_name },
    { label: 'הורה', value: (r) => r.parent_name },
    { label: 'שכר לימוד', value: (r) => n(r.due), numeric: true },
    { label: 'שולם', value: (r) => n(r.paid), numeric: true },
    { label: 'יתרה', value: (r) => n(r.balance), numeric: true },
    { label: 'תשלום אחרון', value: (r) => (r.last_paid_on ? formatDate(r.last_paid_on) : '—') },
    { label: 'ימים', value: (r) => n(r.days_outstanding), numeric: true },
    { label: 'גיל החוב', value: (r) => AGING_LABEL[n(r.aging_bucket)] ?? '' },
  ],
  display: (r, c) => (c.label === 'ימים' ? num(c.value(r)) : c.numeric ? money(c.value(r)) : String(c.value(r) ?? '—')),
  chart: { xKey: 'גיל החוב', series: [{ key: 'סך חוב', label: 'סך חוב', color: 'var(--bad)' }] },
  toChart: (rows) => [0, 30, 60, 90].map((b) => ({
    'גיל החוב': AGING_LABEL[b] ?? '', 'סך חוב': rows.filter((r) => n(r.aging_bucket) === b).reduce((s, r) => s + n(r.balance), 0),
  })),
};

// ─────────── 4. נוכחות ───────────
export type LessonRow = {
  branch_name: string | null; lesson_date: string | null; status: string | null;
  attended: number | null; marked: number | null; expected: number | null;
};
export type AttendanceRow = { branch: string; lessons: number; reported: number; attended: number; expected: number; pct: number | null };
export function attendanceByBranch(lessons: LessonRow[]): AttendanceRow[] {
  const by = new Map<string, AttendanceRow>();
  for (const l of lessons) {
    const key = l.branch_name ?? '—';
    const row = by.get(key) ?? { branch: key, lessons: 0, reported: 0, attended: 0, expected: 0, pct: null };
    row.lessons += 1;
    if (l.status === 'reported') { row.reported += 1; row.attended += n(l.attended); row.expected += n(l.expected); }
    by.set(key, row);
  }
  return [...by.values()].map((r) => ({ ...r, pct: r.expected > 0 ? Math.round((100 * r.attended) / r.expected) : null }))
    .sort((a, b) => a.branch.localeCompare(b.branch, 'he'));
}
export const ATTENDANCE: ReportDef<AttendanceRow> = {
  id: 'attendance', title: 'נוכחות', subtitle: 'לפי סניף, שיעורים שדווחו',
  columns: [
    { label: 'סניף', value: (r) => r.branch },
    { label: 'שיעורים', value: (r) => r.lessons, numeric: true },
    { label: 'דווחו', value: (r) => r.reported, numeric: true },
    { label: 'נוכחות', value: (r) => r.attended, numeric: true },
    { label: 'צפויות', value: (r) => r.expected, numeric: true },
    { label: 'אחוז נוכחות', value: (r) => r.pct, numeric: true },
  ],
  display: (r, c) => (c.label === 'אחוז נוכחות' ? (r.pct === null ? '—' : formatPercent(r.pct)) : num(c.value(r))),
  chart: { xKey: 'סניף', series: [{ key: 'אחוז נוכחות', label: 'אחוז נוכחות', color: 'var(--sage)' }] },
  toChart: (rows) => rows.map((r) => ({ 'סניף': r.branch, 'אחוז נוכחות': r.pct ?? 0 })),
};

// ─────────── 5. נשירה ───────────
export type StudentRow = {
  full_name: string | null; branch_name: string | null; status: string | null;
  joined_on: string | null; stopped_on: string | null; stop_reason: string | null;
};
export const CHURN: ReportDef<StudentRow> = {
  id: 'churn', title: 'נשירה', subtitle: 'תלמידות שהפסיקו, לפי חודש וסיבה',
  columns: [
    { label: 'תלמידה', value: (r) => r.full_name },
    { label: 'סניף', value: (r) => r.branch_name },
    { label: 'הצטרפה', value: (r) => (r.joined_on ? formatDate(r.joined_on) : '—') },
    { label: 'הפסיקה', value: (r) => (r.stopped_on ? formatDate(r.stopped_on) : '—') },
    { label: 'סיבה', value: (r) => r.stop_reason ?? '' },
  ],
  display: (r, c) => String(c.value(r) ?? '—'),
  chart: { xKey: 'חודש', series: [{ key: 'הפסיקו', label: 'הפסיקו', color: 'var(--amber)' }] },
  toChart: (rows) => {
    const by = new Map<string, number>();
    for (const r of rows) { const k = monthLabel(r.stopped_on); by.set(k, (by.get(k) ?? 0) + 1); }
    return [...by.entries()].sort().map(([k, v]) => ({ 'חודש': k, 'הפסיקו': v }));
  },
};

// ─────────── 6. רווח לפי הפקה ───────────
export type ProductionRow = {
  name: string | null; year: string | null; status: string | null; budget: number | null;
  expenses: number | null; income: number | null; profit: number | null;
  budget_used_pct: number | null; cast_count: number | null;
};
export const PRODUCTION_STATUS: Record<string, string> = {
  planning: 'בתכנון', rehearsals: 'בחזרות', filming: 'בצילומים', editing: 'בעריכה', released: 'הופץ',
};
export const PRODUCTIONS: ReportDef<ProductionRow> = {
  id: 'productions', title: 'רווח לפי הפקה', subtitle: 'תקציב, ביצוע, הכנסות ורווח לכל סרט',
  columns: [
    { label: 'הפקה', value: (r) => r.name },
    { label: 'שנה', value: (r) => r.year ?? '' },
    { label: 'מצב', value: (r) => PRODUCTION_STATUS[r.status ?? ''] ?? r.status ?? '' },
    { label: 'תקציב', value: (r) => n(r.budget), numeric: true },
    { label: 'הוצאות', value: (r) => n(r.expenses), numeric: true },
    { label: 'ניצול תקציב', value: (r) => r.budget_used_pct, numeric: true },
    { label: 'הכנסות', value: (r) => n(r.income), numeric: true },
    { label: 'רווח', value: (r) => n(r.profit), numeric: true },
    { label: 'משתתפות', value: (r) => n(r.cast_count), numeric: true },
  ],
  display: (r, c) =>
    c.label === 'ניצול תקציב' ? (r.budget_used_pct === null ? '—' : formatPercent(n(r.budget_used_pct)))
    : c.label === 'משתתפות' ? num(c.value(r))
    : c.numeric ? money(c.value(r)) : String(c.value(r) ?? '—'),
  chart: { xKey: 'הפקה', series: [
    { key: 'הוצאות', label: 'הוצאות', color: 'var(--bad)' },
    { key: 'הכנסות', label: 'הכנסות', color: 'var(--ok)' },
    { key: 'רווח', label: 'רווח', color: 'var(--plum)' },
  ] },
  toChart: (rows) => rows.map((r) => ({ 'הפקה': r.name ?? '', 'הוצאות': n(r.expenses), 'הכנסות': n(r.income), 'רווח': n(r.profit) })),
};

// ─────────── 7. המרת פניות ───────────
export type LeadRow = { month: string | null; leads: number | null; converted: number | null; pending: number | null; lost: number | null; conversion_pct: number | null };
export const LEADS: ReportDef<LeadRow> = {
  id: 'leads', title: 'המרת פניות לתלמידות', subtitle: 'לידים מוואטסאפ לפי חודש',
  columns: [
    { label: 'חודש', value: (r) => monthLabel(r.month) },
    { label: 'פניות', value: (r) => n(r.leads), numeric: true },
    { label: 'נרשמו', value: (r) => n(r.converted), numeric: true },
    { label: 'ממתינות', value: (r) => n(r.pending), numeric: true },
    { label: 'לא נרשמו', value: (r) => n(r.lost), numeric: true },
    { label: 'אחוז המרה', value: (r) => n(r.conversion_pct), numeric: true },
  ],
  display: (r, c) => (c.label === 'אחוז המרה' ? formatPercent(n(c.value(r))) : c.numeric ? num(c.value(r)) : String(c.value(r) ?? '—')),
  chart: { xKey: 'חודש', series: [
    { key: 'פניות', label: 'פניות', color: 'var(--soft)' },
    { key: 'נרשמו', label: 'נרשמו', color: 'var(--ok)' },
  ] },
  toChart: (rows) => rows.map((r) => ({ 'חודש': monthLabel(r.month), 'פניות': n(r.leads), 'נרשמו': n(r.converted) })),
};

/** כל הדוחות, בסדר התצוגה. הבדיקה עוברת על הרשימה הזו. */
export const ALL_REPORTS = [PNL, BRANCHES, COLLECTION, ATTENDANCE, CHURN, PRODUCTIONS, LEADS] as const;

/** שורות לדוגמה לכל דוח — לבדיקת הייצוא. עברית, מספרים, ריקים. */
export const SAMPLE_ROWS: Record<ReportId, unknown[]> = {
  pnl: [{ month: '2026-09-01', income_students: 20700, income_other: 85500, expenses: 79700, expenses_branch: 30000, expenses_general: 12000, expenses_production: 37700, profit: 26500 }],
  branches: [{ name: 'ביתר עילית', active_students: 6, income_students: 5000, income_other: 0, expenses: 3200, open_debt: 1400, profit_before: 1800, allocated: 2400, profit_after: -600 }],
  collection: [{ full_name: 'שירה כהן', branch_name: 'ביתר עילית', parent_name: 'רחל כהן', parent_phone: null, due: 2000, paid: 700, balance: 1300, last_paid_on: '2026-08-15', days_outstanding: 45, aging_bucket: 30 }],
  attendance: [{ branch: 'אשדוד', lessons: 5, reported: 4, attended: 15, expected: 20, pct: 75 }],
  churn: [{ full_name: 'רוחי אפשטיין', branch_name: 'ירושלים רמות', status: 'stopped', joined_on: '2026-06-01', stopped_on: '2026-08-20', stop_reason: 'עברה עיר' }],
  productions: [{ name: 'הדרך הביתה', year: 'תשפ״ו', status: 'released', budget: 38000, expenses: 14800, income: 46500, profit: 31700, budget_used_pct: 39, cast_count: 4 }],
  leads: [{ month: '2026-09-01', leads: 3, converted: 1, pending: 1, lost: 1, conversion_pct: 33 }],
};
