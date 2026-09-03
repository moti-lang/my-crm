/**
 * ליבת הייצוא — טהורה, בלי DOM. כאן כדי שבדיקה ב-Node תוכל להריץ אותה
 * על כל הגדרת דוח ולוודא שמה שיוצא לאקסל הוא בדיוק מה שבטבלה.
 *
 * הכללים:
 *   · מספר נשאר מספר (לא "₪1,234" כטקסט) — כדי שאפשר יהיה לסכם באקסל.
 *   · תאריך יוצא כ-dd/MM/yyyy, כמו במסך.
 *   · הכותרות בעברית, כמו במסך. אין שמות עמודות באנגלית בקובץ שהלקוחה רואה.
 */
import * as XLSX from 'xlsx';

export type CellValue = string | number | null;

export type Column<T> = {
  /** כותרת בעברית */
  label: string;
  /** מחלץ ערך גולמי לייצוא: מספר לסכומים, מחרוזת לטקסט ולתאריכים מעוצבים */
  value: (row: T) => CellValue;
  /** מיושר לימין כברירת מחדל; מספרים — tabular */
  numeric?: boolean;
};

export type Sheet = { name: string; columns: Column<unknown>[]; rows: unknown[] };

/** שם גיליון באקסל: עד 31 תווים, בלי התווים האסורים. */
export function sheetName(name: string): string {
  return name.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'דוח';
}

export function toAoa<T>(columns: Column<T>[], rows: T[]): CellValue[][] {
  return [columns.map((c) => c.label), ...rows.map((r) => columns.map((c) => c.value(r)))];
}

export function buildWorkbook(sheets: Sheet[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(toAoa(s.columns, s.rows));
    // RTL בגיליון, ורוחב עמודות סביר לעברית.
    ws['!cols'] = s.columns.map((c) => ({ wch: Math.max(12, c.label.length + 4) }));
    if (!wb.Workbook) wb.Workbook = {};
    if (!wb.Workbook.Views) wb.Workbook.Views = [];
    wb.Workbook.Views.push({ RTL: true });
    XLSX.utils.book_append_sheet(wb, ws, sheetName(s.name));
  }
  return wb;
}

export function workbookToBuffer(wb: XLSX.WorkBook): ArrayBuffer {
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

/** CSV עם BOM כדי שאקסל בעברית יפתח אותו נכון. */
export function toCsv<T>(columns: Column<T>[], rows: T[]): string {
  const ws = XLSX.utils.aoa_to_sheet(toAoa(columns, rows));
  return '﻿' + XLSX.utils.sheet_to_csv(ws);
}

/** קריאה חוזרת של חוברת — לבדיקות ולייבוא. */
export function readWorkbook(data: ArrayBuffer | Uint8Array): XLSX.WorkBook {
  return XLSX.read(data, { type: 'array' });
}

export function sheetToAoa(wb: XLSX.WorkBook, index = 0): CellValue[][] {
  const name = wb.SheetNames[index];
  if (!name) return [];
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<CellValue[]>(ws, { header: 1, defval: null });
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * מסמך HTML להדפסה/PDF. עברית, RTL, גופני המערכת.
 *
 * למה הדפסה ולא ספריית PDF: יצירת PDF בדפדפן דורשת הטמעת גופן עברי
 * וטיפול ידני בכיווניות (מספרים בתוך עברית מתהפכים). מנוע ההדפסה של
 * הדפדפן עושה את שניהם נכון, ו"שמירה כ-PDF" קיימת בכל דפדפן.
 */
export function buildPrintHtml(opts: {
  title: string; subtitle?: string; generatedAt: string;
  sections: { heading?: string; columns: Column<unknown>[]; rows: unknown[]; display?: (row: unknown, col: Column<unknown>) => string }[];
}): string {
  const sections = opts.sections.map((s) => {
    const head = s.columns.map((c) => `<th class="${c.numeric ? 'num' : ''}">${esc(c.label)}</th>`).join('');
    const body = s.rows.map((r) =>
      `<tr>${s.columns.map((c) => {
        const v = s.display ? s.display(r, c) : String(c.value(r) ?? '—');
        return `<td class="${c.numeric ? 'num' : ''}">${esc(v)}</td>`;
      }).join('')}</tr>`).join('');
    return `${s.heading ? `<h2>${esc(s.heading)}</h2>` : ''}<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }).join('');

  return `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>${esc(opts.title)}</title>
<style>
  @page { margin: 14mm; }
  body { font-family: Heebo, "Segoe UI", Arial, sans-serif; color: #241a2e; margin: 0; padding: 16px; }
  h1 { font-size: 20px; margin: 0 0 2px; } h2 { font-size: 15px; margin: 18px 0 6px; }
  .sub { color: #6b5d78; font-size: 12px; margin-bottom: 12px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; page-break-inside: auto; }
  th, td { border-bottom: 1px solid #e1d9e6; padding: 5px 7px; text-align: right; vertical-align: top; }
  th { background: #f0eaf3; font-weight: 600; }
  td.num, th.num { text-align: left; direction: ltr; font-variant-numeric: tabular-nums; }
  tr { page-break-inside: avoid; }
  .foot { margin-top: 14px; color: #6b5d78; font-size: 11px; }
</style></head><body>
<h1>${esc(opts.title)}</h1>
<div class="sub">${opts.subtitle ? esc(opts.subtitle) + ' · ' : ''}הופק ${esc(opts.generatedAt)}</div>
${sections}
<div class="foot">החוג של הניה טייכטל · מערכת ניהול</div>
</body></html>`;
}
