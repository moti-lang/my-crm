/**
 * ייצוא תלמידות לאקסל — העמודות. טהור (בלי DOM ובלי מסד), כדי שהבדיקה ב-Node תריץ
 * בדיוק את ההגדרה הזו: תכתוב קובץ, תקרא אותו בחזרה ותשווה תא-תא מול המסד.
 *
 * השורות מגיעות מ-rpc_students_export: ההרשאה שם (מנהלת סניף — רק הסניף שלה; רואת
 * חשבון — בלי טלפונים, כתובת ומייל). כאן רק הצגה:
 *   · מספר נשאר מספר (סכומים, גיל). תאריך — dd/MM/yyyy. כן/לא בעברית.
 *   · טלפון כטקסט בפורמט מקומי (050-…): בלי זה אקסל מוחק את האפס ומציג 5.01E+11.
 *   · לרואת חשבון עמודות הקשר לא קיימות בקובץ בכלל (לא רק ריקות).
 */
import type { Column, CellValue } from './export-core';
import { formatPhone } from './format';
import { STATUS_LABEL, type StudentStatus } from './studentStatus';

export type StudentExportRow = {
  id: string; branch_id: string | null; branch_name: string | null; full_name: string | null;
  birth_date: string | null; age: number | null; grade: string | null; school: string | null; group_name: string | null;
  parent_name: string | null; parent_phone?: string | null; alt_phone?: string | null; email?: string | null; address?: string | null;
  status: string | null; joined_on: string | null; payment_track_label: string | null; external_payment: boolean | null;
  tuition_total: number | null; discount: number | null; registration_fee: number | null; paid: number | null; balance: number | null;
  payments_count: number | null; installments_planned: number | null;
  photo_consent: boolean | null; mailing_consent: boolean | null; whatsapp_opt_in: boolean | null;
  terms_accepted_at: string | null; notes: string | null; contact_hidden?: boolean;
};

const text = (v: string | null | undefined): CellValue => (v == null || v === '' ? null : v);
const num = (v: number | string | null | undefined): CellValue => (v == null || v === '' ? null : Number(v));
const yesNo = (v: boolean | null | undefined): CellValue => (v === true ? 'כן' : v === false ? 'לא' : null);

/** תאריך בלבד (YYYY-MM-DD) → dd/MM/yyyy, בלי המרת אזור זמן. */
export function dayOf(v: string | null | undefined): CellValue {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}
/** חותמת זמן → היום בישראל, dd/MM/yyyy (אישור תקנון בחצות לא "זז" ליום אחר). */
export function dayOfInstant(v: string | null | undefined): CellValue {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year}`;
}
const phone = (v: string | null | undefined): CellValue => (v ? formatPhone(v) : null);

type Col = Column<StudentExportRow> & { contact?: boolean };

const COLUMNS: Col[] = [
  { label: 'שם מלא', value: (r) => text(r.full_name) },
  { label: 'תאריך לידה', value: (r) => dayOf(r.birth_date) },
  { label: 'גיל', value: (r) => num(r.age), numeric: true },
  { label: 'כיתה', value: (r) => text(r.grade) },
  { label: 'בית ספר', value: (r) => text(r.school) },
  { label: 'סניף', value: (r) => text(r.branch_name) },
  { label: 'קבוצה', value: (r) => text(r.group_name) },
  { label: 'שם ההורה', value: (r) => text(r.parent_name) },
  { label: 'טלפון', value: (r) => phone(r.parent_phone), contact: true },
  { label: 'טלפון נוסף', value: (r) => phone(r.alt_phone), contact: true },
  { label: 'מייל', value: (r) => text(r.email), contact: true },
  { label: 'כתובת', value: (r) => text(r.address), contact: true },
  { label: 'סטטוס', value: (r) => text(STATUS_LABEL[r.status as StudentStatus] ?? r.status) },
  { label: 'תאריך הצטרפות', value: (r) => dayOf(r.joined_on) },
  { label: 'מסלול התשלום', value: (r) => text(r.external_payment ? 'תשלום חיצוני' : r.payment_track_label) },
  { label: 'שכר לימוד', value: (r) => num(r.tuition_total), numeric: true },
  // הנחה: בלעדיה שכר לימוד + דמי רישום − שולם לא היה יוצא היתרה.
  { label: 'הנחה', value: (r) => num(r.discount), numeric: true },
  { label: 'דמי רישום', value: (r) => num(r.registration_fee), numeric: true },
  { label: 'שולם', value: (r) => num(r.paid), numeric: true },
  { label: 'יתרה', value: (r) => num(r.balance), numeric: true },
  { label: 'תשלום', value: (r) => {
    const done = Number(r.payments_count ?? 0), of = r.installments_planned;
    return of ? `${done} מתוך ${of}` : done ? `${done} תשלומים` : null;
  } },
  { label: 'אישור צילום', value: (r) => yesNo(r.photo_consent) },
  { label: 'הסכמה לתפוצה', value: (r) => yesNo(r.mailing_consent) },
  { label: 'הסכמה לוואטסאפ', value: (r) => yesNo(r.whatsapp_opt_in) },
  { label: 'תאריך אישור התקנון', value: (r) => dayOfInstant(r.terms_accepted_at) },
  { label: 'הערות', value: (r) => text(r.notes) },
];

/** העמודות לפי מי שמייצאת. contactHidden — רואת חשבון: בלי עמודות הקשר. */
export function studentExportColumns(contactHidden: boolean): Column<StudentExportRow>[] {
  return contactHidden ? COLUMNS.filter((c) => !c.contact) : COLUMNS;
}

/** הכותרות של עמודות הקשר — לבדיקות (שלא יופיעו בקובץ של רואת חשבון). */
export const CONTACT_LABELS = COLUMNS.filter((c) => c.contact).map((c) => c.label);

/** שם הקובץ: "תלמידות" או "תלמידות - <סניף>". */
export function exportFileName(branchName?: string | null): string {
  return branchName ? `תלמידות - ${branchName}` : 'תלמידות';
}
