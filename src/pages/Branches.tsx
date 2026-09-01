import { Link } from 'react-router-dom';
import { useBranches, useBranchPnl } from '@/hooks/queries';
import { formatILS, formatPhone, formatWeekdays } from '@/lib/format';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/States';

export function Branches() {
  const branches = useBranches();
  const pnl = useBranchPnl();

  if (branches.isError) return <ErrorState error={branches.error} onRetry={() => void branches.refetch()} />;
  if (branches.isLoading) {
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} rows={4} />)}
      </div>
    );
  }

  const rows = branches.data ?? [];
  if (rows.length === 0) {
    return <EmptyState title="אין סניפים להצגה" hint="ייתכן שאינך משויכת לאף סניף. פני לניהול." />;
  }

  const pnlBy = new Map((pnl.data ?? []).map((p) => [p.branch_id, p]));

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl">סניפים</h1>
        <p className="text-sm text-soft">{rows.length} סניפים</p>
      </header>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((b) => {
          const p = pnlBy.get(b.id);
          const income = Number(p?.income_students ?? 0) + Number(p?.income_other ?? 0);
          const profit = income - Number(p?.expenses ?? 0);
          return (
            <Link key={b.id} to={`/branches/${b.id}`} className="card block p-4 hover:bg-shade">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-display text-lg">{b.name}</h2>
                <span className={`rounded-full px-2 py-0.5 text-xs ${b.is_active ? 'bg-ok/15 text-ok' : 'bg-shade text-soft'}`}>
                  {b.is_active ? 'פעיל' : 'לא פעיל'}
                </span>
              </div>
              <dl className="mt-3 space-y-1 text-sm text-soft">
                <div className="flex gap-2"><dt>כתובת:</dt><dd className="text-ink">{b.address ?? '—'}, {b.city ?? ''}</dd></div>
                <div className="flex gap-2"><dt>ימים:</dt><dd className="text-ink">{b.schedule_text ?? formatWeekdays(b.weekdays)}</dd></div>
                <div className="flex gap-2"><dt>אחראית:</dt><dd className="text-ink">{b.supervisor_name ?? '—'}</dd></div>
                <div className="flex gap-2"><dt>טלפון:</dt><dd className="text-ink" dir="ltr">{formatPhone(b.supervisor_phone)}</dd></div>
              </dl>
              <div className="mt-3 grid grid-cols-3 gap-2 border-t border-rule pt-3 text-center text-xs">
                <div><p className="text-soft">תלמידות</p><p className="tabular-nums text-ink">{p?.active_students ?? 0}</p></div>
                <div><p className="text-soft">חוב פתוח</p><p className="tabular-nums text-warn">{formatILS(p?.open_debt)}</p></div>
                <div><p className="text-soft">רווח</p><p className={`tabular-nums ${profit >= 0 ? 'text-ok' : 'text-bad'}`}>{formatILS(profit)}</p></div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
