import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useCurrentSeasonId, useDebtors } from '@/hooks/finance';
import { useLessonSummary } from '@/hooks/attendance';
import { useStudents } from '@/hooks/students';
import { useProductions } from '@/hooks/productions';
import { usePnlMonthly, useBranchProfitability, useLeadFunnel } from '@/hooks/reports';
import { ALL_REPORTS, attendanceByBranch, type ReportDef, type ReportId } from '@/reports/definitions';
import { exportXlsx, exportCsv, exportPdf } from '@/lib/export';
import type { Column } from '@/lib/export-core';
import { formatILS } from '@/lib/format';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/States';

/**
 * דוחות (סעיף 5.13): כל דוח — גרף, טבלה, וייצוא לאקסל, CSV ו-PDF.
 * ההגדרות ב-reports/definitions.ts; כאן רק נתונים ותצוגה.
 */
export function Reports() {
  const [active, setActive] = useState<ReportId>('pnl');
  const seasonId = useCurrentSeasonId();

  const pnl = usePnlMonthly(seasonId.data);
  const branches = useBranchProfitability();
  const debtors = useDebtors();
  const lessons = useLessonSummary();
  const students = useStudents();
  const productions = useProductions();
  const leads = useLeadFunnel();

  const attendanceRows = useMemo(() => attendanceByBranch(lessons.data ?? []), [lessons.data]);
  const churnRows = useMemo(
    () => (students.data ?? []).filter((s) => s.status === 'stopped').sort((a, b) => (b.stopped_on ?? '').localeCompare(a.stopped_on ?? '')),
    [students.data],
  );

  const sources: Record<ReportId, { rows: unknown[]; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void }> = {
    pnl: { rows: pnl.data ?? [], isLoading: pnl.isLoading, isError: pnl.isError, error: pnl.error, refetch: () => void pnl.refetch() },
    branches: { rows: branches.data ?? [], isLoading: branches.isLoading, isError: branches.isError, error: branches.error, refetch: () => void branches.refetch() },
    collection: { rows: debtors.data ?? [], isLoading: debtors.isLoading, isError: debtors.isError, error: debtors.error, refetch: () => void debtors.refetch() },
    attendance: { rows: attendanceRows, isLoading: lessons.isLoading, isError: lessons.isError, error: lessons.error, refetch: () => void lessons.refetch() },
    churn: { rows: churnRows, isLoading: students.isLoading, isError: students.isError, error: students.error, refetch: () => void students.refetch() },
    productions: { rows: productions.data ?? [], isLoading: productions.isLoading, isError: productions.isError, error: productions.error, refetch: () => void productions.refetch() },
    leads: { rows: leads.data ?? [], isLoading: leads.isLoading, isError: leads.isError, error: leads.error, refetch: () => void leads.refetch() },
  };

  const def = ALL_REPORTS.find((r) => r.id === active) as ReportDef<unknown>;
  const src = sources[active];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl">דוחות</h1>
        <p className="text-sm text-soft">גרף, טבלה וייצוא — לכל דוח</p>
      </header>

      <nav className="flex gap-1 overflow-x-auto pb-1" aria-label="בחירת דוח">
        {ALL_REPORTS.map((r) => (
          <button
            key={r.id} type="button" onClick={() => setActive(r.id)}
            className={`shrink-0 rounded-btn px-3 py-1.5 text-sm ${r.id === active ? 'bg-plum text-white' : 'border border-rule text-ink hover:bg-shade'}`}
            aria-pressed={r.id === active}
          >
            {r.title}
          </button>
        ))}
      </nav>

      <ReportPanel def={def} rows={src.rows} isLoading={src.isLoading} isError={src.isError} error={src.error} onRetry={src.refetch} />
    </div>
  );
}

function ReportPanel({ def, rows, isLoading, isError, error, onRetry }: {
  def: ReportDef<unknown>; rows: unknown[]; isLoading: boolean; isError: boolean; error: unknown; onRetry: () => void;
}) {
  const chartData = useMemo(() => def.toChart(rows), [def, rows]);
  const totals = useMemo(() => columnTotals(def.columns, rows), [def, rows]);

  if (isError) return <ErrorState error={error} onRetry={onRetry} />;
  if (isLoading) return <CardSkeleton rows={6} />;

  const fileBase = `דוח-${def.title.replace(/\s+/g, '-')}`;
  const doXlsx = () => exportXlsx(fileBase, [{ name: def.title, columns: def.columns, rows }]);
  const doCsv = () => exportCsv(fileBase, def.columns, rows);
  const doPdf = () => exportPdf({ title: def.title, subtitle: def.subtitle, sections: [{ columns: def.columns, rows, display: def.display }] });

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg">{def.title}</h2>
          <p className="text-sm text-soft">{def.subtitle}</p>
        </div>
        <div className="flex gap-1">
          <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={doXlsx} disabled={rows.length === 0}>אקסל</button>
          <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={doCsv} disabled={rows.length === 0}>CSV</button>
          <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={doPdf} disabled={rows.length === 0}>PDF</button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="אין נתונים לדוח הזה" hint="כשיהיו רשומות מתאימות, הן יופיעו כאן." />
      ) : (
        <>
          <div className="card p-3" dir="ltr">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid stroke="var(--rule)" vertical={false} />
                <XAxis dataKey={def.chart.xKey} tick={{ fill: 'var(--soft)', fontSize: 12 }} reversed />
                <YAxis tick={{ fill: 'var(--soft)', fontSize: 12 }} orientation="right" tickFormatter={(v: number) => compact(v)} />
                <Tooltip
                  contentStyle={{ background: 'var(--card)', border: '1px solid var(--rule)', borderRadius: 8, direction: 'rtl' }}
                  formatter={(v: number, name: string) => [isMoneyReport(def.id) ? formatILS(v) : String(v), name]}
                />
                <Legend wrapperStyle={{ direction: 'rtl' }} />
                {def.chart.series.map((s) => (
                  <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="card table-wrap">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="border-b border-rule text-right text-soft">
                <tr>
                  {def.columns.map((c) => (
                    <th key={c.label} className={`px-3 py-2 font-medium ${c.numeric ? 'text-left' : ''}`}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-rule last:border-0">
                    {def.columns.map((c) => (
                      <td key={c.label} className={`px-3 py-2 ${c.numeric ? 'text-left tabular-nums' : ''}`} dir={c.numeric ? 'ltr' : undefined}>
                        {def.display(r, c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {totals.some((t) => t !== null) && (
                <tfoot className="border-t border-rule bg-shade/60 font-medium">
                  <tr>
                    {def.columns.map((c, i) => (
                      <td key={c.label} className={`px-3 py-2 ${c.numeric ? 'text-left tabular-nums' : ''}`} dir={c.numeric ? 'ltr' : undefined}>
                        {i === 0 ? 'סה״כ' : totals[i] === null ? '' : isMoneyColumn(def.id, c) ? formatILS(totals[i]) : String(totals[i])}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </section>
  );
}

const PERCENT_LABELS = new Set(['אחוז נוכחות', 'אחוז המרה', 'ניצול תקציב', 'ימים']);

function columnTotals(columns: Column<unknown>[], rows: unknown[]): (number | null)[] {
  return columns.map((c) => {
    if (!c.numeric || PERCENT_LABELS.has(c.label)) return null;
    return rows.reduce<number>((s, r) => s + Number(c.value(r) ?? 0), 0);
  });
}

const MONEY_REPORTS = new Set<ReportId>(['pnl', 'branches', 'collection', 'productions']);
const isMoneyReport = (id: ReportId) => MONEY_REPORTS.has(id);
const COUNT_LABELS = new Set(['תלמידות פעילות', 'משתתפות', 'שיעורים', 'דווחו', 'נוכחות', 'צפויות', 'פניות', 'נרשמו', 'ממתינות', 'לא נרשמו']);
const isMoneyColumn = (id: ReportId, c: Column<unknown>) => isMoneyReport(id) && !COUNT_LABELS.has(c.label);

function compact(v: number): string {
  if (Math.abs(v) >= 1000) return `${Math.round(v / 1000)}K`;
  return String(v);
}
