import { useMemo } from 'react';
import { useListParams, useScrollMemory } from '@/hooks/listState';
import { EVENT_LABEL, STANDING_LABEL, STANDING_TONE, useStandingEvents, useStandingOrders, type StandingEvent } from '@/hooks/standing';
import { StandingOrderPanel } from '@/components/StandingOrderPanel';
import { formatDate, formatDateTime, formatILS } from '@/lib/format';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/States';

/** כל הוראות הקבע ומצבן. מה שצריך טיפול — באדום ולמעלה. */
const STANDING_VIEW = { open: '' } as const;

export function StandingOrders() {
  const list = useStandingOrders();
  const events = useStandingEvents();
  // ההוראה שפרטיה פתוחים — בכתובת, כמו בשאר הרשימות; והגלילה נשמרת.
  const [view, setView] = useListParams(STANDING_VIEW);
  const open = view.open || null;
  const setOpen = (id: string) => setView({ open: id });
  useScrollMemory(!list.isLoading);
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
              <th className="px-3 py-2 font-medium">חיוב</th><th className="px-3 py-2 font-medium">סכום</th><th className="px-3 py-2 font-medium">הבא</th><th className="px-3 py-2 font-medium">יום</th><th className="px-3 py-2 font-medium"></th>
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
                <td className="px-3 py-2 tabular-nums">{r.billing_day && r.next_billing ? r.billing_day : '—'}</td>
                <td className="px-3 py-2">
                  {open === r.id ? <StandingOrderPanel order={r} /> :
                    <button type="button" className="text-xs text-plum hover:underline" onClick={() => r.id && setOpen(r.id)}>פרטים</button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <StandingJournal rows={events.data ?? []} loading={events.isLoading} />
    </div>
  );
}

/** יומן הוראות הקבע: מי שינה, מתי, ומאיזה תאריך לאיזה (דרך המערכת, או שינוי שנעשה ב-SUMIT ונקלט). */
function StandingJournal({ rows, loading }: { rows: StandingEvent[]; loading: boolean }) {
  if (loading || rows.length === 0) return null;
  return (
    <section className="space-y-2" aria-label="יומן הוראות הקבע">
      <h2 className="text-lg">יומן שינויים</h2>
      <div className="card table-wrap">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="border-b border-rule text-right text-soft"><tr>
            <th className="px-3 py-2 font-medium">מתי</th><th className="px-3 py-2 font-medium">תלמידה</th><th className="px-3 py-2 font-medium">מי</th>
            <th className="px-3 py-2 font-medium">מה</th><th className="px-3 py-2 font-medium">מתאריך</th><th className="px-3 py-2 font-medium">לתאריך</th>
          </tr></thead>
          <tbody>{rows.map((e) => (
            <tr key={e.id} className="border-b border-rule last:border-0">
              <td className="px-3 py-2 tabular-nums">{formatDateTime(e.created_at)}</td>
              <td className="px-3 py-2">{e.full_name}<span className="block text-xs text-soft">{e.branch_name}</span></td>
              <td className="px-3 py-2">{e.actor_label}</td>
              <td className="px-3 py-2">{EVENT_LABEL[e.kind ?? ''] ?? e.kind}{e.to_day ? ` · ל-${e.to_day} בחודש` : ''}</td>
              <td className="px-3 py-2 tabular-nums">{formatDate(e.from_date)}</td>
              <td className="px-3 py-2 tabular-nums">{formatDate(e.to_date)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}
