/**
 * ייצוא לדפדפן: אקסל, CSV, ו-PDF דרך הדפסה. הליבה ב-export-core.ts.
 */
import { buildWorkbook, workbookToBuffer, toCsv, buildPrintHtml, type Column, type Sheet } from './export-core';
import { formatDate } from './format';

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

export function exportXlsx(baseName: string, sheets: Sheet[]) {
  const buf = workbookToBuffer(buildWorkbook(sheets));
  download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
           `${baseName}-${stamp()}.xlsx`);
}

export function exportCsv<T>(baseName: string, columns: Column<T>[], rows: T[]) {
  download(new Blob([toCsv(columns, rows)], { type: 'text/csv;charset=utf-8' }), `${baseName}-${stamp()}.csv`);
}

/**
 * פותח חלון הדפסה עם הדוח. "שמירה כ-PDF" בדיאלוג של הדפדפן.
 * display מקבל את הערך המעוצב למסך (₪, תאריכים), לא את הגולמי.
 */
export function exportPdf(opts: {
  title: string; subtitle?: string;
  sections: { heading?: string; columns: Column<unknown>[]; rows: unknown[]; display?: (row: unknown, col: Column<unknown>) => string }[];
}) {
  const html = buildPrintHtml({
    ...opts,
    generatedAt: `${formatDate(new Date())} ${new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' })}`,
  });
  const w = window.open('', '_blank', 'noopener,width=900,height=700');
  if (!w) {
    window.alert('הדפדפן חסם את חלון ההדפסה. אפשרי חלונות קופצים לאתר הזה ונסי שוב.');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  // מחכים לגופנים ולפריסה לפני הדפסה.
  w.addEventListener('load', () => setTimeout(() => w.print(), 150));
  setTimeout(() => { try { w.print(); } catch { /* כבר הודפס */ } }, 900);
}
