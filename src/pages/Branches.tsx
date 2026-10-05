import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { useBranches, useBranchPnl } from '@/hooks/queries';
import { useCreateBranch, type BranchInput } from '@/hooks/branches';
import { BranchForm, normalizeBranchPhone } from '@/components/BranchForm';
import { humanError } from '@/lib/errors';
import { formatILS, formatPhone, formatWeekdays } from '@/lib/format';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/States';

export function Branches() {
  const branches = useBranches();
  const pnl = useBranchPnl();
  const { profile } = useAuth();
  const [adding, setAdding] = useState(false);

  if (branches.isError) return <ErrorState error={branches.error} onRetry={() => void branches.refetch()} />;
  if (branches.isLoading) {
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} rows={4} />)}
      </div>
    );
  }

  const rows = branches.data ?? [];
  const isOwner = profile?.role === 'owner';
  if (rows.length === 0 && !isOwner) {
    return <EmptyState title="אין סניפים להצגה" hint="ייתכן שאינך משויכת לאף סניף. פני לניהול." />;
  }

  const pnlBy = new Map((pnl.data ?? []).map((p) => [p.branch_id, p]));

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl">סניפים</h1>
        <div className="flex items-center gap-2">
          <p className="text-sm text-soft">{rows.length} סניפים</p>
          {isOwner && !adding && <button type="button" className="btn-primary px-3 py-1 text-xs" onClick={() => setAdding(true)}>הוספת סניף</button>}
        </div>
      </header>

      {adding && <AddBranch onDone={() => setAdding(false)} />}

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

/**
 * סניף חדש: פרטים בסיסיים. התקנון ומבנה התשלום מועתקים מברירת המחדל
 * (מסך ההגדרות), ואחרי השמירה עוברים לסניף כדי לשנות מה שצריך.
 */
function AddBranch({ onDone }: { onDone: () => void }) {
  const create = useCreateBranch();
  const navigate = useNavigate();
  const [value, setValue] = useState<BranchInput>({ name: '', weekdays: [] });
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const name = (value.name ?? '').trim();
    if (!name) { setError('יש למלא שם סניף'); return; }
    try {
      const id = await create.mutateAsync({ ...value, name, supervisor_phone: normalizeBranchPhone(value.supervisor_phone) });
      onDone();
      navigate(`/branches/${id}?tab=settings`);
    } catch (err) { setError(humanError(err)); }
  }

  return (
    <form onSubmit={submit} className="card space-y-3 p-4">
      <h2 className="text-lg">סניף חדש</h2>
      <p className="text-sm text-soft">התקנון ומבנה התשלום יועתקו מברירת המחדל שבהגדרות. אחרי השמירה אפשר לשנות אותם לסניף הזה בלבד, וגם לקבל את קישור ההרשמה שלו.</p>
      <BranchForm value={value} onChange={setValue} />
      {error && <p className="text-sm text-bad" role="alert">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={create.isPending}>{create.isPending ? 'יוצרת…' : 'יצירת הסניף'}</button>
        <button type="button" className="btn-ghost" onClick={onDone}>ביטול</button>
      </div>
    </form>
  );
}
