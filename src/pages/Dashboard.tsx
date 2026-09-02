import { Link } from 'react-router-dom';
import { useBranchPnl, useStudentBalances, useUnreportedToday, useCurrentSeason } from '@/hooks/queries';
import { formatILS } from '@/lib/format';
import { CardSkeleton, ErrorState, EmptyState } from '@/components/States';
import { WaDownBanner } from '@/components/WaHealthBadge';

export function Dashboard() {
  const pnl = useBranchPnl();
  const balances = useStudentBalances();
  const unreported = useUnreportedToday();
  const season = useCurrentSeason();

  if (pnl.isError) return <ErrorState error={pnl.error} onRetry={() => void pnl.refetch()} />;

  const rows = pnl.data ?? [];
  const income = rows.reduce((s, r) => s + Number(r.income_students ?? 0) + Number(r.income_other ?? 0), 0);
  const expenses = rows.reduce((s, r) => s + Number(r.expenses ?? 0), 0);
  const debtors = (balances.data ?? []).filter((b) => Number(b.balance ?? 0) > 0);
  const openDebt = debtors.reduce((s, b) => s + Number(b.balance ?? 0), 0);

  const topDebtors = [...debtors].sort((a, b) => Number(b.balance ?? 0) - Number(a.balance ?? 0)).slice(0, 5);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl">דשבורד</h1>
        <p className="text-sm text-soft">{season.data?.name ?? 'טוען עונה…'}</p>
      </header>

      <WaDownBanner />

      {(unreported.data?.length ?? 0) > 0 && (
        <Link
          to="/attendance"
          className="block rounded-card border border-bad/40 bg-bad/10 p-4 text-sm text-bad hover:bg-bad/15"
        >
          יש {unreported.data?.length} שיעורים היום שטרם דווחה בהם נוכחות
          {' · '}
          {(unreported.data ?? []).map((l) => l.branches?.name).filter(Boolean).join(', ')}
          {' ← לדיווח'}
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="הכנסות העונה" value={formatILS(income)} loading={pnl.isLoading} />
        <Kpi label="הוצאות העונה" value={formatILS(expenses)} loading={pnl.isLoading} />
        <Kpi label="רווח" value={formatILS(income - expenses)} loading={pnl.isLoading} tone={income - expenses >= 0 ? 'ok' : 'bad'} />
        <Kpi
          label="חוב פתוח"
          value={formatILS(openDebt)}
          hint={`${debtors.length} חייבות`}
          loading={balances.isLoading}
          tone={openDebt > 0 ? 'warn' : 'ok'}
        />
      </div>

      <section>
        <h2 className="mb-2 text-lg">רווחיות לפי סניף</h2>
        {pnl.isLoading ? (
          <CardSkeleton rows={5} />
        ) : rows.length === 0 ? (
          <EmptyState title="אין עדיין סניפים" hint="אפשר להוסיף סניף ממסך הסניפים." />
        ) : (
          <div className="card table-wrap">
            <table className="w-full min-w-[38rem] text-sm">
              <thead className="border-b border-rule text-right text-soft">
                <tr>
                  <th className="px-4 py-2 font-medium">סניף</th>
                  <th className="px-4 py-2 font-medium">תלמידות</th>
                  <th className="px-4 py-2 font-medium">הכנסות</th>
                  <th className="px-4 py-2 font-medium">הוצאות</th>
                  <th className="px-4 py-2 font-medium">רווח</th>
                  <th className="px-4 py-2 font-medium">חוב פתוח</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const inc = Number(r.income_students ?? 0) + Number(r.income_other ?? 0);
                  const exp = Number(r.expenses ?? 0);
                  return (
                    <tr key={r.branch_id} className="border-b border-rule last:border-0 hover:bg-shade">
                      <td className="px-4 py-2">
                        <Link className="text-plum hover:underline" to={`/branches/${r.branch_id}`}>
                          {r.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2 tabular-nums">{r.active_students ?? 0}</td>
                      <td className="px-4 py-2 tabular-nums">{formatILS(inc)}</td>
                      <td className="px-4 py-2 tabular-nums">{formatILS(exp)}</td>
                      <td className={`px-4 py-2 tabular-nums ${inc - exp >= 0 ? 'text-ok' : 'text-bad'}`}>
                        {formatILS(inc - exp)}
                      </td>
                      <td className="px-4 py-2 tabular-nums">{formatILS(r.open_debt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg">החייבות הגדולות</h2>
        {balances.isLoading ? (
          <CardSkeleton rows={5} />
        ) : topDebtors.length === 0 ? (
          <EmptyState title="אין חובות פתוחים" hint="כל התלמידות שילמו במלואן." />
        ) : (
          <ul className="card divide-y divide-rule">
            {topDebtors.map((d) => (
              <li key={d.student_id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span>{d.full_name}</span>
                <span className="tabular-nums text-bad">{formatILS(d.balance)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Kpi({
  label, value, hint, loading, tone,
}: { label: string; value: string; hint?: string; loading?: boolean; tone?: 'ok' | 'warn' | 'bad' }) {
  const toneClass = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : 'text-ink';
  return (
    <div className="card p-4">
      <p className="text-xs text-soft">{label}</p>
      {loading ? (
        <div className="mt-2 h-7 w-24 animate-pulse rounded bg-shade" />
      ) : (
        <p className={`mt-1 font-display text-xl tabular-nums ${toneClass}`}>{value}</p>
      )}
      {hint && !loading && <p className="mt-0.5 text-xs text-soft">{hint}</p>}
    </div>
  );
}
