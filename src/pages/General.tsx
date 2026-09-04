import { useMemo } from 'react';
import { useLedger, useGeneralAllocation, useUpdateSplitMethod } from '@/hooks/finance';
import { formatILS, formatDate } from '@/lib/format';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/States';
import type { Enums } from '@/lib/database.types';

const SPLIT_LABEL: Record<Enums<'split_method'>, string> = {
  none: 'לא מחולק',
  equal: 'שווה בין הסניפים',
  by_students: 'לפי מספר תלמידות',
  manual: 'ידני',
};

export function General() {
  const ledger = useLedger('general');
  const allocation = useGeneralAllocation();
  const updateSplit = useUpdateSplitMethod();

  const rows = ledger.data ?? [];
  const expenses = useMemo(() => rows.filter((e) => e.kind === 'expense'), [rows]);
  const income = useMemo(() => rows.filter((e) => e.kind === 'income'), [rows]);

  const totalExpense = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const totalIncome = income.reduce((s, e) => s + Number(e.amount), 0);
  const allocated = (allocation.data ?? []).reduce((s, a) => s + Number(a.allocated_amount ?? 0), 0);
  const unallocated = expenses
    .filter((e) => e.split_method === 'none')
    .reduce((s, e) => s + Number(e.amount), 0);

  if (ledger.isError) return <ErrorState error={ledger.error} onRetry={() => void ledger.refetch()} />;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl">כספים כלליים</h1>
        <p className="text-sm text-soft">הוצאות והכנסות שאינן משויכות לסניף</p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="הוצאות כלליות" value={formatILS(totalExpense)} tone="text-bad" />
        <Kpi label="הכנסות כלליות" value={formatILS(totalIncome)} tone="text-ok" />
        <Kpi label="מוקצה לסניפים" value={formatILS(allocated)} />
        <Kpi label="לא מחולק" value={formatILS(unallocated)} tone="text-soft" />
      </div>

      <section>
        <h2 className="mb-2 text-lg">הוצאות</h2>
        {ledger.isLoading ? (
          <CardSkeleton rows={5} />
        ) : expenses.length === 0 ? (
          <EmptyState title="אין הוצאות כלליות" />
        ) : (
          <div className="card table-wrap">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="border-b border-rule text-right text-soft">
                <tr>
                  <th className="px-3 py-2 font-medium">תאריך</th>
                  <th className="px-3 py-2 font-medium">קטגוריה</th>
                  <th className="px-3 py-2 font-medium">ספק</th>
                  <th className="px-3 py-2 font-medium">סכום</th>
                  <th className="px-3 py-2 font-medium">שיטת חלוקה</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id} className="border-b border-rule last:border-0">
                    <td className="px-3 py-2">{formatDate(e.entry_date)}</td>
                    <td className="px-3 py-2">{e.category}</td>
                    <td className="px-3 py-2">{e.vendor ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{formatILS(e.amount)}</td>
                    <td className="px-3 py-2">
                      <select
                        className="field py-1 text-xs"
                        value={e.split_method}
                        disabled={updateSplit.isPending}
                        onChange={(ev) =>
                          void updateSplit.mutateAsync({
                            id: e.id,
                            split_method: ev.target.value as Enums<'split_method'>,
                          })
                        }
                        aria-label={`שיטת חלוקה עבור ${e.category}`}
                      >
                        {Object.entries(SPLIT_LABEL).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                      {e.split_method === 'manual' && !e.split_manual && (
                        <span className="mr-2 text-xs text-warn">לא הוגדרו משקלים</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {income.length > 0 && (
        <section>
          <h2 className="mb-2 text-lg">הכנסות</h2>
          <div className="card table-wrap">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="border-b border-rule text-right text-soft">
                <tr>
                  <th className="px-3 py-2 font-medium">תאריך</th>
                  <th className="px-3 py-2 font-medium">קטגוריה</th>
                  <th className="px-3 py-2 font-medium">תיאור</th>
                  <th className="px-3 py-2 font-medium">סכום</th>
                </tr>
              </thead>
              <tbody>
                {income.map((e) => (
                  <tr key={e.id} className="border-b border-rule last:border-0">
                    <td className="px-3 py-2">{formatDate(e.entry_date)}</td>
                    <td className="px-3 py-2">{e.category}</td>
                    <td className="px-3 py-2">{e.description ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums text-ok">{formatILS(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-lg">השפעת החלוקה</h2>
        {allocation.isLoading ? (
          <CardSkeleton rows={5} />
        ) : (
          <div className="card table-wrap">
            <table className="w-full min-w-[24rem] text-sm">
              <thead className="border-b border-rule text-right text-soft">
                <tr>
                  <th className="px-3 py-2 font-medium">סניף</th>
                  <th className="px-3 py-2 font-medium">מוקצה מההוצאות הכלליות</th>
                </tr>
              </thead>
              <tbody>
                {(allocation.data ?? []).map((a) => (
                  <tr key={a.branch_id} className="border-b border-rule last:border-0">
                    <td className="px-3 py-2">{a.branch_name}</td>
                    <td className="px-3 py-2 tabular-nums">{formatILS(a.allocated_amount)}</td>
                  </tr>
                ))}
                <tr className="bg-shade font-medium">
                  <td className="px-3 py-2">סך הכל</td>
                  <td className="px-3 py-2 tabular-nums">{formatILS(allocated)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-soft">
          החלוקה מחושבת במסד בשיטת השארית הגדולה:
          סכום ההקצאות שווה בדיוק לסכום ההוצאה, ללא שארית עיגול.
          הוצאה בשיטת "לא מחולק" נשארת ברמת ההנהלה ואינה נזקפת לאף סניף.
        </p>
      </section>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-soft">{label}</p>
      <p className={`mt-1 font-display text-lg tabular-nums ${tone ?? 'text-ink'}`}>{value}</p>
    </div>
  );
}
