import { useMemo, useState } from 'react';
import { useBranches } from '@/hooks/queries';
import { useStudents } from '@/hooks/students';
import { useCurrentSeasonId } from '@/hooks/finance';
import { useImportStudents } from '@/hooks/import';
import { readWorkbook, sheetToAoa, type CellValue, type Column } from '@/lib/export-core';
import { exportXlsx } from '@/lib/export';
import {
  autoMap, parseRows, buildTemplateAoa, FIELD_LABEL, REQUIRED, ERROR_COLUMNS,
  type Field, type ParsedRow,
} from '@/lib/import-core';
import { formatPhone } from '@/lib/format';
import { humanError } from '@/lib/errors';

type Step = 'upload' | 'map' | 'preview' | 'done';
const FIELDS = Object.keys(FIELD_LABEL) as Field[];

/**
 * ייבוא אקסל של תלמידות (סעיף 5.3): קובץ ← מיפוי עמודות ← תצוגה מקדימה
 * עם דוח שגיאות ← ייבוא של התקינות בלבד. השורות הפגומות לא נעצרות
 * ולא נבלעות: הן מקבלות שגיאה בעברית, וניתן להוריד אותן כדוח.
 */
export function ImportStudents({ onClose }: { onClose: () => void }) {
  const branches = useBranches();
  const students = useStudents();
  const season = useCurrentSeasonId();
  const importRows = useImportStudents();

  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState('');
  const [aoa, setAoa] = useState<CellValue[][]>([]);
  const [mapping, setMapping] = useState<(Field | null)[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ inserted: number[]; failed: { line: number; message: string }[] } | null>(null);

  const headers = aoa[0] ?? [];
  const ctx = useMemo(() => ({
    branches: (branches.data ?? []).map((b) => ({ id: b.id, name: b.name, default_tuition: b.default_tuition })),
    existing: (students.data ?? []).filter((s) => s.full_name && s.branch_id)
      .map((s) => ({ full_name: s.full_name as string, branch_id: s.branch_id as string, parent_phone: s.parent_phone })),
  }), [branches.data, students.data]);
  const parsed: ParsedRow[] = useMemo(() => (step === 'preview' || step === 'done' ? parseRows(aoa, mapping, ctx) : []), [aoa, mapping, ctx, step]);
  const valid = parsed.filter((p) => p.row && p.errors.length === 0);
  const invalid = parsed.filter((p) => p.errors.length > 0);
  const missingRequired = REQUIRED.filter((f) => !mapping.includes(f));

  async function onFile(file: File) {
    setError(null);
    try {
      const wb = readWorkbook(new Uint8Array(await file.arrayBuffer()));
      const rows = sheetToAoa(wb, 0);
      if (rows.length < 2) { setError('הקובץ ריק — צריך שורת כותרות ולפחות שורה אחת.'); return; }
      setFileName(file.name);
      setAoa(rows);
      setMapping(autoMap(rows[0] ?? []));
      setStep('map');
    } catch (err) {
      setError(`לא הצלחתי לקרוא את הקובץ: ${humanError(err)}`);
    }
  }

  function downloadTemplate() {
    const example = branches.data?.[0]?.name ?? 'ביתר עילית';
    const rows = buildTemplateAoa(example);
    const cols: Column<CellValue[]>[] = (rows[0] ?? []).map((h, i) => ({ label: String(h), value: (r) => r[i] ?? null }));
    exportXlsx('תבנית-ייבוא-תלמידות', [{ name: 'תלמידות', columns: cols as Column<unknown>[], rows: rows.slice(1) }]);
  }

  function downloadErrors() {
    const rows = invalid.flatMap((p) => p.errors.map((e) => ({ ...e, name: p.raw.full_name || '—' })));
    exportXlsx('דוח-שגיאות-ייבוא', [{ name: 'שגיאות', columns: ERROR_COLUMNS as Column<unknown>[], rows }]);
  }

  async function runImport() {
    setError(null);
    if (!season.data) { setError('אין עונה נוכחית מוגדרת.'); return; }
    try {
      const r = await importRows.mutateAsync({ seasonId: season.data, rows: valid.map((p) => ({ line: p.line, row: p.row! })) });
      setResult(r);
      setStep('done');
    } catch (err) {
      setError(humanError(err));
    }
  }

  return (
    <section className="card p-4" aria-label="ייבוא תלמידות מאקסל">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg">ייבוא תלמידות מאקסל</h2>
        <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={onClose}>סגירה</button>
      </div>

      <ol className="mb-4 flex flex-wrap gap-2 text-xs text-soft">
        {(['upload', 'map', 'preview', 'done'] as Step[]).map((s, i) => (
          <li key={s} className={`rounded-btn px-2 py-0.5 ${step === s ? 'bg-plum text-white' : 'bg-shade'}`}>
            {i + 1}. {{ upload: 'קובץ', map: 'מיפוי עמודות', preview: 'תצוגה מקדימה', done: 'תוצאה' }[s]}
          </li>
        ))}
      </ol>

      {error && <p className="mb-3 text-sm text-bad" role="alert">{error}</p>}

      {step === 'upload' && (
        <div className="space-y-3 text-sm">
          <p>קובץ xlsx או csv עם שורת כותרות. חובה: <b>שם התלמידה</b> ו<b>סניף</b> (בשם המדויק כמו במערכת). השאר אופציונלי.</p>
          {/* הקלט המקורי מוסתר: הדפדפן מציג עליו "Choose File" באנגלית. */}
          <label className="btn-primary cursor-pointer">
            בחירת קובץ
            <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" aria-label="בחירת קובץ"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} />
          </label>
          <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={downloadTemplate}>הורדת תבנית לדוגמה</button>
        </div>
      )}

      {step === 'map' && (
        <div className="space-y-3 text-sm">
          <p>{fileName} · {aoa.length - 1} שורות. לכל עמודה בקובץ — לאיזה שדה היא שייכת. עמודה שלא ממופה מתעלמים ממנה.</p>
          <div className="table-wrap">
            <table className="w-full min-w-[30rem]">
              <thead className="text-right text-soft"><tr><th className="px-2 py-1 font-medium">עמודה בקובץ</th><th className="px-2 py-1 font-medium">דוגמה</th><th className="px-2 py-1 font-medium">שדה במערכת</th></tr></thead>
              <tbody>
                {headers.map((h, i) => (
                  <tr key={i} className="border-t border-rule">
                    <td className="px-2 py-1 font-medium">{String(h ?? `עמודה ${i + 1}`)}</td>
                    <td className="px-2 py-1 text-soft">{String(aoa[1]?.[i] ?? '')}</td>
                    <td className="px-2 py-1">
                      <select className="field py-1" value={mapping[i] ?? ''} aria-label={`שדה עבור ${String(h ?? i + 1)}`}
                        onChange={(e) => setMapping((m) => m.map((v, j) => (j === i ? ((e.target.value || null) as Field | null) : v === e.target.value ? null : v)))}>
                        <option value="">— לא בשימוש —</option>
                        {FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABEL[f]}{REQUIRED.includes(f) ? ' *' : ''}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {missingRequired.length > 0 && <p className="text-bad">חסר מיפוי לשדות חובה: {missingRequired.map((f) => FIELD_LABEL[f]).join(', ')}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn-primary" disabled={missingRequired.length > 0} onClick={() => setStep('preview')}>לתצוגה מקדימה</button>
            <button type="button" className="btn-ghost" onClick={() => setStep('upload')}>קובץ אחר</button>
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-btn bg-ok/15 px-2 py-0.5 text-ok">{valid.length} תקינות</span>
            <span className={`rounded-btn px-2 py-0.5 ${invalid.length ? 'bg-bad/15 text-bad' : 'bg-shade text-soft'}`}>{invalid.length} עם שגיאות</span>
            {invalid.length > 0 && <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={downloadErrors}>הורדת דוח השגיאות</button>}
          </div>
          <p className="text-soft">רק השורות התקינות ייובאו. שורה עם שגיאה נשארת בקובץ שלך — תקני ותייבאי שוב.</p>
          <div className="table-wrap max-h-[24rem] overflow-y-auto">
            <table className="w-full min-w-[44rem]">
              <thead className="text-right text-soft"><tr>
                <th className="px-2 py-1 font-medium">שורה</th><th className="px-2 py-1 font-medium">שם</th><th className="px-2 py-1 font-medium">סניף</th>
                <th className="px-2 py-1 font-medium">טלפון</th><th className="px-2 py-1 font-medium">שכר לימוד</th><th className="px-2 py-1 font-medium">מצב</th>
              </tr></thead>
              <tbody>
                {parsed.map((p) => (
                  <tr key={p.line} className={`border-t border-rule ${p.errors.length ? 'bg-bad/5' : ''}`}>
                    <td className="px-2 py-1 tabular-nums">{p.line}</td>
                    <td className="px-2 py-1">{p.raw.full_name || '—'}</td>
                    <td className="px-2 py-1">{p.row?.branch_name ?? p.raw.branch}</td>
                    <td className="px-2 py-1" dir="ltr">{p.row?.parent_phone ? formatPhone(p.row.parent_phone) : p.raw.parent_phone || '—'}</td>
                    <td className="px-2 py-1 tabular-nums">{p.row ? p.row.tuition_total : p.raw.tuition_total}</td>
                    <td className="px-2 py-1">
                      {p.errors.length > 0
                        ? <ul className="text-bad">{p.errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
                        : <span className="text-ok">תקינה</span>}
                      {p.warnings.length > 0 && <ul className="text-warn">{p.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-primary" disabled={valid.length === 0 || importRows.isPending} onClick={() => void runImport()}>
              {importRows.isPending ? 'מייבאת…' : `ייבוא ${valid.length} תלמידות`}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setStep('map')}>חזרה למיפוי</button>
          </div>
        </div>
      )}

      {step === 'done' && result && (
        <div className="space-y-3 text-sm">
          <p className="text-ok">יובאו {result.inserted.length} תלמידות.</p>
          {result.failed.length > 0 && (
            <div className="text-bad">
              <p>{result.failed.length} שורות נדחו במסד:</p>
              <ul>{result.failed.map((f) => <li key={f.line}>שורה {f.line}: {humanError(new Error(f.message))}</li>)}</ul>
            </div>
          )}
          {invalid.length > 0 && <p className="text-warn">{invalid.length} שורות עם שגיאות לא יובאו. <button type="button" className="underline" onClick={downloadErrors}>דוח השגיאות</button></p>}
          <button type="button" className="btn-primary" onClick={onClose}>סיום</button>
        </div>
      )}
    </section>
  );
}
