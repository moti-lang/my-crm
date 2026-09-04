import { humanError } from '@/lib/errors';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { useLedger, useCategories, useAddLedgerEntry, useCurrentSeasonId, useSoftDeleteEntry } from '@/hooks/finance';
import { useBranches } from '@/hooks/queries';
import { formatILS, formatDate } from '@/lib/format';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/States';

const METHOD_LABEL: Record<string, string> = {
  cash: 'מזומן', transfer: 'העברה', bit: 'ביט', credit: 'אשראי', check: 'צ׳ק', other: 'אחר',
};

// גוון סגול־ורוד אחיד, לא לוח צבעים מקרי
const SLICE_COLORS = ['#5B2A57', '#B03A62', '#8A5480', '#C4728C', '#6E4269', '#D69AAC', '#4A2247', '#A0637F'];

const schema = z.object({
  branch_id: z.string().min(1, 'יש לבחור סניף'),
  entry_date: z.string().min(1, 'יש לבחור תאריך'),
  category: z.string().min(1, 'יש לבחור קטגוריה'),
  amount: z.coerce.number().positive('הסכום חייב להיות גדול מאפס'),
  vendor: z.string().optional(),
  description: z.string().optional(),
  method: z.enum(['cash', 'transfer', 'bit', 'credit', 'check', 'other']),
  is_recurring: z.boolean().default(false),
  recurring_day: z.coerce.number().int().min(1).max(28).optional(),
});
type FormValues = z.input<typeof schema>;

export function Expenses() {
  const ledger = useLedger('branch');
  const branches = useBranches();
  const categories = useCategories('branch', 'expense');
  const season = useCurrentSeasonId();
  const addEntry = useAddLedgerEntry();
  const softDelete = useSoftDeleteEntry();

  const [branchFilter, setBranchFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const rows = useMemo(() => {
    return (ledger.data ?? []).filter((e) => {
      if (e.kind !== 'expense') return false;
      if (branchFilter && e.branch_id !== branchFilter) return false;
      if (categoryFilter && e.category !== categoryFilter) return false;
      if (from && e.entry_date < from) return false;
      if (to && e.entry_date > to) return false;
      return true;
    });
  }, [ledger.data, branchFilter, categoryFilter, from, to]);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of rows) map.set(e.category, (map.get(e.category) ?? 0) + Number(e.amount));
    return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [rows]);

  const total = rows.reduce((s, e) => s + Number(e.amount), 0);

  if (ledger.isError) return <ErrorState error={ledger.error} onRetry={() => void ledger.refetch()} />;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl">הוצאות סניפים</h1>
        <p className="text-sm text-soft">{rows.length} רשומות · {formatILS(total)}</p>
      </header>

      <QuickAddForm
        branches={branches.data ?? []}
        categories={(categories.data ?? []).map((c) => c.name)}
        seasonId={season.data ?? null}
        busy={addEntry.isPending}
        error={addEntry.error}
        onSubmit={async (values) => {
          if (!season.data) throw new Error('לא נמצאה עונה נוכחית');
          await addEntry.mutateAsync({
            season_id: season.data,
            kind: 'expense',
            scope: 'branch',
            branch_id: values.branch_id,
            entry_date: values.entry_date,
            category: values.category,
            amount: Number(values.amount),
            vendor: values.vendor || null,
            description: values.description || null,
            method: values.method,
            is_recurring: Boolean(values.is_recurring),
            recurring_day: values.is_recurring ? Number(values.recurring_day) || 1 : null,
          });
        }}
      />

      <div className="grid gap-2 sm:grid-cols-4">
        <select className="field" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} aria-label="סינון לפי סניף">
          <option value="">כל הסניפים</option>
          {(branches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select className="field" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="סינון לפי קטגוריה">
          <option value="">כל הקטגוריות</option>
          {(categories.data ?? []).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
        </select>
        <input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="מתאריך" />
        <input type="date" className="field" value={to} onChange={(e) => setTo(e.target.value)} aria-label="עד תאריך" />
      </div>

      {ledger.isLoading ? (
        <CardSkeleton rows={6} />
      ) : rows.length === 0 ? (
        <EmptyState title="אין הוצאות שמתאימות לסינון" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_17rem]">
          <div className="card table-wrap">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="border-b border-rule text-right text-soft">
                <tr>
                  <th className="px-3 py-2 font-medium">תאריך</th>
                  <th className="px-3 py-2 font-medium">סניף</th>
                  <th className="px-3 py-2 font-medium">קטגוריה</th>
                  <th className="px-3 py-2 font-medium">ספק</th>
                  <th className="px-3 py-2 font-medium">אמצעי</th>
                  <th className="px-3 py-2 font-medium">סכום</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className="border-b border-rule last:border-0 hover:bg-shade">
                    <td className="px-3 py-2">{formatDate(e.entry_date)}</td>
                    <td className="px-3 py-2">{e.branches?.name ?? '—'}</td>
                    <td className="px-3 py-2">
                      {e.category}
                      {e.is_recurring && <span className="mr-1 rounded-full bg-shade px-1.5 py-0.5 text-xs text-soft">קבועה</span>}
                    </td>
                    <td className="px-3 py-2">{e.vendor ?? '—'}</td>
                    <td className="px-3 py-2">{e.method ? METHOD_LABEL[e.method] ?? e.method : '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{formatILS(e.amount)}</td>
                    <td className="px-3 py-2">
                      <button type="button" className="text-xs text-soft hover:text-bad" onClick={() => setConfirmDelete(e.id)}>
                        מחיקה
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card p-4">
            <h2 className="mb-2 text-sm font-medium text-soft">לפי קטגוריה</h2>
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={byCategory} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2}>
                    {byCategory.map((_, i) => (
                      <Cell key={i} fill={SLICE_COLORS[i % SLICE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatILS(v)} />
                  <Legend wrapperStyle={{ fontSize: 12, direction: 'rtl' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="למחוק את ההוצאה?"
          body="הרשומה תסומן כמחוקה ותיעלם מהדוחות. אפשר לשחזר אותה במסד."
          busy={softDelete.isPending}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            await softDelete.mutateAsync(confirmDelete);
            setConfirmDelete(null);
          }}
        />
      )}
    </div>
  );
}

function QuickAddForm({
  branches, categories, seasonId, busy, error, onSubmit,
}: {
  branches: { id: string; name: string }[];
  categories: string[];
  seasonId: string | null;
  busy: boolean;
  error: unknown;
  onSubmit: (values: FormValues) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { entry_date: new Date().toISOString().slice(0, 10), method: 'transfer', is_recurring: false },
  });
  const isRecurring = watch('is_recurring');

  if (!open) {
    return (
      <button type="button" className="btn-primary" onClick={() => setOpen(true)} disabled={!seasonId}>
        + הוספת הוצאה
      </button>
    );
  }

  return (
    <form
      className="card space-y-3 p-4"
      onSubmit={handleSubmit(async (values) => {
        await onSubmit(values);
        reset({ entry_date: new Date().toISOString().slice(0, 10), method: 'transfer', is_recurring: false });
        setOpen(false);
      })}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="סניף" error={errors.branch_id?.message}>
          <select className="field" {...register('branch_id')}>
            <option value="">בחרי סניף</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="קטגוריה" error={errors.category?.message}>
          <select className="field" {...register('category')}>
            <option value="">בחרי קטגוריה</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="סכום" error={errors.amount?.message}>
          <input type="number" step="0.01" min="0" className="field" {...register('amount')} />
        </Field>
        <Field label="תאריך" error={errors.entry_date?.message}>
          <input type="date" className="field" {...register('entry_date')} />
        </Field>
        <Field label="ספק">
          <input type="text" className="field" {...register('vendor')} />
        </Field>
        <Field label="אמצעי תשלום">
          <select className="field" {...register('method')}>
            {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      </div>

      <Field label="תיאור">
        <input type="text" className="field" {...register('description')} />
      </Field>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" {...register('is_recurring')} />
        הוצאה קבועה שחוזרת כל חודש
      </label>
      {isRecurring && (
        <Field label="יום בחודש (1-28)" error={errors.recurring_day?.message}>
          <input type="number" min="1" max="28" className="field sm:w-32" {...register('recurring_day')} />
        </Field>
      )}

      {error != null && (
        <p className="text-sm text-bad" role="alert">
          {humanError(error)}
        </p>
      )}

      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'שומר…' : 'שמירה'}</button>
        <button type="button" className="btn-ghost" onClick={() => { reset(); setOpen(false); }}>ביטול</button>
      </div>
    </form>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="text-soft">{label}</span>
      <div className="mt-1">{children}</div>
      {error && <span className="mt-0.5 block text-xs text-bad">{error}</span>}
    </label>
  );
}

export function ConfirmDialog({
  title, body, busy, onCancel, onConfirm,
}: { title: string; body: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-30 bg-ink/30" onClick={onCancel} role="presentation" />
      <div className="fixed inset-x-4 top-1/3 z-40 mx-auto max-w-sm rounded-card bg-card p-5 shadow-pop" role="dialog" aria-modal="true">
        <h2 className="font-display text-lg">{title}</h2>
        <p className="mt-1 text-sm text-soft">{body}</p>
        <div className="mt-4 flex gap-2">
          <button type="button" className="btn-primary flex-1" onClick={onConfirm} disabled={busy}>
            {busy ? 'מוחק…' : 'אישור'}
          </button>
          <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>ביטול</button>
        </div>
      </div>
    </>
  );
}
