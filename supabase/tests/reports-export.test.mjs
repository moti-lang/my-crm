#!/usr/bin/env node
/**
 * ★ כל דוח מייצא קובץ תקין, והקובץ שחוזר זהה לשורות.
 *
 * הראיה אינה "הכפתור קיים": ליבת הייצוא רצה באמת על כל הגדרת דוח,
 * החוברת נכתבת לבתים, נקראת בחזרה, ומושווית תא-תא. עברית שורדת,
 * מספר נשאר מספר (לא "₪1,234" כטקסט), ו-CSV נפתח עם BOM.
 *
 * הרצה:  npm run test:reports
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codeOf } from './_code.mjs';

const dir = mkdtempSync(join(tmpdir(), 'reports-'));
// CJS ולא ESM: xlsx דורש מודולים של Node (stream) בזמן ריצה, ובחבילת
// ESM זה נופל על "Dynamic require". ב-CJS ה-require אמיתי.
const bundle = (src, name) => {
  const out = join(dir, name);
  execFileSync('npx', ['esbuild', src, '--bundle', '--format=cjs', '--platform=node', `--outfile=${out}`,
    '--log-level=error', '--alias:@=./src'], { stdio: 'inherit' });
  return out;
};
const load = async (src, name) => { const m = await import(bundle(src, name)); return m.default ?? m; };

const core = await load('src/lib/export-core.ts', 'export-core.cjs');
const defs = await load('src/reports/definitions.ts', 'definitions.cjs');

let fails = 0;
const check = (label, ok, detail = '') => {
  if (!ok) fails++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
};

const EXPECTED = ['pnl', 'branches', 'collection', 'attendance', 'churn', 'productions', 'leads'];
console.log('\nהגדרות הדוחות:');
check('★ שבעת הדוחות מהאפיון קיימים', EXPECTED.every((id) => defs.ALL_REPORTS.some((r) => r.id === id)),
      `חסרים: ${EXPECTED.filter((id) => !defs.ALL_REPORTS.some((r) => r.id === id)).join(', ')}`);

for (const def of defs.ALL_REPORTS) {
  console.log(`\n${def.title}:`);
  const rows = defs.SAMPLE_ROWS[def.id] ?? [];
  check('יש שורות לדוגמה', rows.length > 0);
  check('★ יש עמודות לייצוא', def.columns.length >= 3, `${def.columns.length} עמודות`);
  check('כותרות בעברית', def.columns.every((c) => /[\u0590-\u05FF]/.test(c.label)),
        def.columns.filter((c) => !/[\u0590-\u05FF]/.test(c.label)).map((c) => c.label).join(', '));
  check('לכל עמודה יש תצוגה למסך', def.columns.every((c) => typeof def.display(rows[0], c) === 'string'));
  check('לגרף יש סדרה אחת לפחות ונתונים', def.chart.series.length > 0 && def.toChart(rows).length > 0);

  // ─── אקסל: כתיבה, קריאה חוזרת, השוואה ───
  const wb = core.buildWorkbook([{ name: def.title, columns: def.columns, rows }]);
  const buf = core.workbookToBuffer(wb);
  const back = core.sheetToAoa(core.readWorkbook(new Uint8Array(buf)));
  const expected = core.toAoa(def.columns, rows);
  check('★ אקסל: הקובץ נקרא בחזרה עם אותו מספר שורות', back.length === expected.length,
        `${back.length} מול ${expected.length}`);
  const mismatches = [];
  expected.forEach((row, i) => row.forEach((cell, j) => {
    const got = back[i]?.[j];
    const want = cell === '' ? null : cell;
    if (got !== want && !(got == null && want == null)) mismatches.push(`[${i},${j}] ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
  }));
  check('★ אקסל: כל תא זהה, עברית ומספרים', mismatches.length === 0, mismatches.slice(0, 3).join(' · '));
  const numericCols = def.columns.map((c, j) => (c.numeric ? j : -1)).filter((j) => j >= 0);
  check('★ מספרים נשארים מספרים (לא טקסט עם ₪)',
        numericCols.every((j) => back.slice(1).every((r) => r[j] === null || typeof r[j] === 'number')));

  // ─── CSV ───
  const csv = core.toCsv(def.columns, rows);
  check('CSV מתחיל ב-BOM', csv.charCodeAt(0) === 0xFEFF);
  check('CSV: שורת כותרת + שורה לכל רשומה', csv.trim().split('\n').length === rows.length + 1);
  check('CSV: הכותרת הראשונה בעברית', csv.slice(1).startsWith(def.columns[0].label));

  // ─── PDF (HTML להדפסה) ───
  const html = core.buildPrintHtml({ title: def.title, subtitle: def.subtitle, generatedAt: '01/01/2026 10:00',
    sections: [{ columns: def.columns, rows, display: def.display }] });
  check('PDF: המסמך RTL ובעברית', /dir="rtl"/.test(html) && /lang="he"/.test(html));
  check('PDF: כל הכותרות מופיעות', def.columns.every((c) => html.includes(c.label)));
  check('PDF: הערך המעוצב (₪) מופיע ולא הגולמי', def.columns.some((c) => c.numeric) ? /₪|%/.test(html) : true);
}

// ─── הדף משתמש בהגדרות, לא בעותק שלהן ───
console.log('\nהדף:');
const page = codeOf('src/pages/Reports.tsx');
check('★ Reports.tsx מייבא את ALL_REPORTS', /ALL_REPORTS/.test(page));
check('★ הייצוא עובר דרך export.ts (אקסל, CSV, PDF)', /exportXlsx\(/.test(page) && /exportCsv\(/.test(page) && /exportPdf\(/.test(page));
check('הגדרות הדוחות טהורות — בלי React ובלי supabase',
      !/from 'react'|@\/lib\/supabase/.test(codeOf('src/reports/definitions.ts')));
check('ליבת הייצוא טהורה — בלי DOM', !/document\.|window\./.test(codeOf('src/lib/export-core.ts')));

console.log(fails === 0 ? '\nכל הדוחות מייצאים נכון' : `\n${fails} בדיקות נכשלו`);
process.exit(fails ? 1 : 0);
