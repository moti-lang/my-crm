import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { useProductions, useAddProduction, PRODUCTION_STATUS_LABEL, type ProductionStatus } from '@/hooks/productions';
import { formatILS, formatDate } from '@/lib/format';
import { humanError } from '@/lib/errors';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/States';

const STATUSES = Object.keys(PRODUCTION_STATUS_LABEL) as ProductionStatus[];

/** הפקות (סעיף 5.7): כרטיס לכל סרט עם פס תקציב מול ביצוע. */
export function Productions() {
  const { profile } = useAuth();
  const productions = useProductions();
  const isOwner = profile?.role === 'owner';
  const [adding, setAdding] = useState(false);

  if (productions.isError) return <ErrorState error={productions.error} onRetry={() => void productions.refetch()} />;

  const rows = productions.data ?? [];
  const totalProfit = rows.reduce((s, p) => s + Number(p.profit ?? 0), 0);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl">הפקות סרטים</h1>
          <p className="text-sm text-soft">{rows.length} הפקות · רווח מצטבר {formatILS(totalProfit)}</p>
        </div>
        {isOwner && (
          <button type="button" className="btn-primary" onClick={() => setAdding((v) => !v)}>
            {adding ? 'סגירה' : 'הפקה חדשה'}
          </button>
        )}
      </header>

      {adding && <NewProductionForm onDone={() => setAdding(false)} />}

      {productions.isLoading ? (
        <CardSkeleton rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState title="אין הפקות עדיין" hint="הפקה חדשה נפתחת מהכפתור למעלה." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => {
            const budget = Number(p.budget ?? 0);
            const spent = Number(p.expenses ?? 0);
            const pct = budget > 0 ? Math.min(100, Math.round((100 * spent) / budget)) : 0;
            const over = budget > 0 && spent > budget;
            const profit = Number(p.profit ?? 0);
            return (
              <Link key={p.production_id} to={`/productions/${p.production_id}`} className="card block p-4 transition-colors hover:bg-shade/40">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-display text-lg text-ink">{p.name}</p>
                    <p className="text-xs text-soft">{p.year ?? ''}{p.release_date ? ` · הופץ ${formatDate(p.release_date)}` : ''}</p>
                  </div>
                  <span className="rounded-btn bg-shade px-2 py-0.5 text-xs text-soft">{PRODUCTION_STATUS_LABEL[p.status as ProductionStatus] ?? p.status}</span>
                </div>

                <div className="mt-3">
                  <div className="flex justify-between text-xs text-soft">
                    <span>ביצוע {formatILS(spent)}</span>
                    <span>תקציב {formatILS(budget)}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-shade" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="ניצול תקציב">
                    <div className={`h-full ${over ? 'bg-bad' : pct > 85 ? 'bg-warn' : 'bg-plum'}`} style={{ width: `${pct}%` }} />
                  </div>
                  {over && <p className="mt-1 text-xs text-bad">חריגה מהתקציב ב-{formatILS(spent - budget)}</p>}
                </div>

                <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div><dt className="text-soft">הכנסות</dt><dd className="font-medium tabular-nums">{formatILS(p.income)}</dd></div>
                  <div><dt className="text-soft">רווח</dt><dd className={`font-medium tabular-nums ${profit < 0 ? 'text-bad' : 'text-ok'}`}>{formatILS(profit)}</dd></div>
                  <div><dt className="text-soft">משתתפות</dt><dd className="font-medium tabular-nums">{p.cast_count ?? 0}</dd></div>
                </dl>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NewProductionForm({ onDone }: { onDone: () => void }) {
  const add = useAddProduction();
  const [name, setName] = useState('');
  const [year, setYear] = useState('');
  const [status, setStatus] = useState<ProductionStatus>('planning');
  const [budget, setBudget] = useState('');
  const [releaseDate, setReleaseDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError('יש להזין שם להפקה.'); return; }
    const b = Number(budget || 0);
    if (!Number.isFinite(b) || b < 0) { setError('התקציב חייב להיות מספר חיובי.'); return; }
    try {
      await add.mutateAsync({ name: name.trim(), year: year.trim() || null, status, budget: b, release_date: releaseDate || null, notes: null });
      onDone();
    } catch (err) {
      setError(humanError(err));
    }
  }

  return (
    <form onSubmit={onSubmit} className="card p-4">
      <h2 className="mb-3 text-lg">הפקה חדשה</h2>
      <div className="grid gap-3 md:grid-cols-5">
        <label className="block text-sm md:col-span-2">שם
          <input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </label>
        <label className="block text-sm">שנה
          <input className="field mt-1" value={year} onChange={(e) => setYear(e.target.value)} placeholder="תשפ״ז" />
        </label>
        <label className="block text-sm">מצב
          <select className="field mt-1" value={status} onChange={(e) => setStatus(e.target.value as ProductionStatus)}>
            {STATUSES.map((s) => <option key={s} value={s}>{PRODUCTION_STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="block text-sm">תקציב
          <input type="number" min="0" step="1" className="field mt-1" value={budget} onChange={(e) => setBudget(e.target.value)} />
        </label>
        <label className="block text-sm">תאריך הפצה
          <input type="date" className="field mt-1" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} />
        </label>
      </div>
      {error && <p className="mt-3 text-sm text-bad" role="alert">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button type="submit" className="btn-primary" disabled={add.isPending}>{add.isPending ? 'שומרת…' : 'שמירה'}</button>
        <button type="button" className="btn-ghost" onClick={onDone}>ביטול</button>
      </div>
    </form>
  );
}
