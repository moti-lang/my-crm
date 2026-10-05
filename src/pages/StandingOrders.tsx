import { useMemo, useState } from 'react';
import { STANDING_LABEL, STANDING_TONE, useStandingOrders } from '@/hooks/standing';
import { StandingOrderPanel } from '@/components/StandingOrderPanel';
import { formatDate, formatILS } from '@/lib/format';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/States';

/** כל הוראות הקבע ומצבן. מה שצריך טיפול — באדום ולמעלה. */
export function StandingOrders() {
  const list = useStandingOrders();
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const attention = rows.filter((r) => r.needs_attention).length;

  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl">הוראות קבע</h1>
        <p className={`text-sm ${attention ? 'text-bad' : 'text-soft'}`}>{rows.length} הוראות{attention ? ` · ${attention} דורשות טיפול` : ''}</p>
      </header>
      {list.isLoading ? <CardSkeleton rows={5} /> : rows.length === 0 ? (
        <EmptyState title="אין עדיין הוראות קבע" hint="הוראה נוצרת אוטומטית אחרי שההורה משלמת את החיוב הראשון במסלול הוראת קבע." />
      ) : (
        <div className="card table-wrap">
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="border-b border-rule text-right text-soft"><tr>
              <th className="px-3 py-2 font-medium">תלמידה</th><th className="px-3 py-2 font-medium">סניף</th><th className="px-3 py-2 font-medium">מצב</th>
              <th className="px-3 py-2 font-medium">חיוב</th><th className="px-3 py-2 font-medium">סכום</th><th className="px-3 py-2 font-medium">הבא</th><th className="px-3 py-2 font-medium"></th>
            </tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className={`border-b border-rule align-top last:border-0 ${r.needs_attention ? 'bg-bad/10' : ''}`}>
                <td className="px-3 py-2 font-medium">{r.full_name}</td>
                <td className="px-3 py-2">{r.branch_name}</td>
                <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs ${STANDING_TONE[r.status ?? ''] ?? ''}`}>{STANDING_LABEL[r.status ?? ''] ?? r.status}</span>
                  {Number(r.failed_count ?? 0) > 0 && <span className="mr-1 text-xs text-bad">{r.failed_count} נדחו</span>}</td>
                <td className="px-3 py-2 tabular-nums">{r.charged_total} / {r.installments_total}</td>
                <td className="px-3 py-2 tabular-nums">{formatILS(r.amount)}</td>
                <td className="px-3 py-2">{r.next_billing ? formatDate(r.next_billing) : '—'}</td>
                <td className="px-3 py-2">
                  {open === r.id ? <StandingOrderPanel order={r} /> :
                    <button type="button" className="text-xs text-plum hover:underline" onClick={() => setOpen(r.id)}>פרטים</button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
