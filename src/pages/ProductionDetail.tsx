import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import {
  useProduction, useProductionLedger, useProductionCast, useAddCast, useRemoveCast,
  useUpdateProduction, useSoftDeleteProduction, PRODUCTION_STATUS_LABEL, type ProductionStatus,
} from '@/hooks/productions';
import { useAddLedgerEntry, useSoftDeleteEntry, useCategories, useCurrentSeasonId } from '@/hooks/finance';
import { useStudents } from '@/hooks/students';
import { formatILS, formatDate } from '@/lib/format';
import { humanError } from '@/lib/errors';
import { exportPdf, exportXlsx } from '@/lib/export';
import type { Column } from '@/lib/export-core';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/States';
import type { Enums, Tables } from '@/lib/database.types';

type Entry = Tables<'ledger_entries'>;
const STATUSES = Object.keys(PRODUCTION_STATUS_LABEL) as ProductionStatus[];
const METHOD_LABEL: Record<string, string> = { cash: 'מזומן', transfer: 'העברה', bit: 'ביט', credit: 'אשראי', check: 'צ׳ק', other: 'אחר' };

const ENTRY_COLUMNS: Column<Entry>[] = [
  { label: 'תאריך', value: (e) => formatDate(e.entry_date) },
  { label: 'קטגוריה', value: (e) => e.category },
  { label: 'ספק / מקור', value: (e) => e.vendor ?? '' },
  { label: 'תיאור', value: (e) => e.description ?? '' },
  { label: 'אמצעי', value: (e) => (e.method ? METHOD_LABEL[e.method] ?? e.method : '') },
  { label: 'סכום', value: (e) => Number(e.amount), numeric: true },
];

/** מסך הפקה (סעיף 5.7): הוצאות, הכנסות, רווח, ומשתתפות. */
export function ProductionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isOwner = profile?.role === 'owner';

  const production = useProduction(id);
  const ledger = useProductionLedger(id);
  const cast = useProductionCast(id);
  const update = useUpdateProduction();
  const softDelete = useSoftDeleteProduction();

  const rows = ledger.data ?? [];
  const expenses = useMemo(() => rows.filter((e) => e.kind === 'expense'), [rows]);
  const income = useMemo(() => rows.filter((e) => e.kind === 'income'), [rows]);

  if (production.isError) return <ErrorState error={production.error} onRetry={() => void production.refetch()} />;
  if (production.isLoading || !id) return <CardSkeleton rows={5} />;
  const p = production.data;
  if (!p) return <EmptyState title="ההפקה לא נמצאה" action={<Link to="/productions" className="btn-ghost">חזרה להפקות</Link>} />;

  const budget = Number(p.budget ?? 0);
  const spent = Number(p.expenses ?? 0);
  const profit = Number(p.profit ?? 0);

  async function onDelete() {
    if (!window.confirm(`למחוק את ההפקה "${p?.name}"? הרשומות הכספיות נשארות בספר הכספים.`)) return;
    await softDelete.mutateAsync(id as string);
    navigate('/productions');
  }

  const displayEntry = (row: unknown, col: Column<unknown>) => {
    const v = col.value(row);
    return col.numeric ? formatILS(typeof v === 'number' ? v : 0) : String(v ?? '—');
  };
  const exportSheets = () => exportXlsx(`הפקה-${p.name}`, [
    { name: 'הוצאות', columns: ENTRY_COLUMNS as Column<unknown>[], rows: expenses },
    { name: 'הכנסות', columns: ENTRY_COLUMNS as Column<unknown>[], rows: income },
  ]);
  const exportPrint = () => exportPdf({
    title: `הפקה: ${p.name}`, subtitle: `תקציב ${formatILS(budget)} · הוצאות ${formatILS(spent)} · הכנסות ${formatILS(p.income)} · רווח ${formatILS(profit)}`,
    sections: [
      { heading: 'הוצאות', columns: ENTRY_COLUMNS as Column<unknown>[], rows: expenses, display: displayEntry },
      { heading: 'הכנסות', columns: ENTRY_COLUMNS as Column<unknown>[], rows: income, display: displayEntry },
    ],
  });

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Link to="/productions" className="text-xs text-soft hover:underline">← כל ההפקות</Link>
          <h1 className="text-2xl">{p.name}</h1>
          <p className="text-sm text-soft">{p.year ?? ''}{p.release_date ? ` · הופץ ${formatDate(p.release_date)}` : ''}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isOwner ? (
            <select
              className="field w-auto py-1" value={p.status ?? 'planning'} aria-label="מצב ההפקה"
              onChange={(e) => void update.mutateAsync({ id, patch: { status: e.target.value as ProductionStatus } })}
            >
              {STATUSES.map((s) => <option key={s} value={s}>{PRODUCTION_STATUS_LABEL[s]}</option>)}
            </select>
          ) : (
            <span className="rounded-btn bg-shade px-2 py-1 text-xs text-soft">{PRODUCTION_STATUS_LABEL[p.status as ProductionStatus]}</span>
          )}
          <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={exportSheets}>אקסל</button>
          <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={exportPrint}>PDF</button>
          {isOwner && <button type="button" className="btn-ghost px-3 py-1 text-xs text-bad" onClick={() => void onDelete()}>מחיקה</button>}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="תקציב" value={formatILS(budget)} editable={isOwner} onSave={(v) => update.mutateAsync({ id, patch: { budget: v } })} raw={budget} />
        <Kpi label="הוצאות" value={formatILS(spent)} tone={budget > 0 && spent > budget ? 'text-bad' : undefined} sub={p.budget_used_pct !== null ? `${p.budget_used_pct}% מהתקציב` : undefined} />
        <Kpi label="הכנסות" value={formatILS(p.income)} tone="text-ok" />
        <Kpi label="רווח" value={formatILS(profit)} tone={profit < 0 ? 'text-bad' : 'text-ok'} />
      </div>

      <EntriesSection title="הוצאות" kind="expense" productionId={id} entries={expenses} loading={ledger.isLoading} canEdit={isOwner} />
      <EntriesSection title="הכנסות" kind="income" productionId={id} entries={income} loading={ledger.isLoading} canEdit={isOwner} />

      <CastSection productionId={id} cast={cast.data ?? []} loading={cast.isLoading} canEdit={isOwner} />

      {isOwner && (
        <NotesEditor notes={p.notes ?? ''} onSave={(notes) => update.mutateAsync({ id, patch: { notes: notes || null } })} />
      )}
    </div>
  );
}

function Kpi({ label, value, tone, sub, editable, onSave, raw }: {
  label: string; value: string; tone?: string; sub?: string; editable?: boolean; onSave?: (v: number) => Promise<unknown>; raw?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(raw ?? 0));
  return (
    <div className="card p-3">
      <p className="text-xs text-soft">{label}</p>
      {editing ? (
        <form
          className="mt-1 flex gap-1"
          onSubmit={(e) => { e.preventDefault(); const v = Number(draft); if (Number.isFinite(v) && v >= 0 && onSave) void onSave(v).then(() => setEditing(false)); }}
        >
          <input type="number" min="0" className="field py-1" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus aria-label={label} />
          <button type="submit" className="btn-primary px-2 py-1 text-xs">שמירה</button>
        </form>
      ) : (
        <button type="button" disabled={!editable} onClick={() => setEditing(true)} className={`mt-1 block text-right font-display text-xl tabular-nums ${tone ?? 'text-ink'} ${editable ? 'hover:underline' : ''}`} title={editable ? 'לחיצה לעריכה' : undefined}>
          {value}
        </button>
      )}
      {sub && <p className="text-xs text-soft">{sub}</p>}
    </div>
  );
}

function EntriesSection({ title, kind, productionId, entries, loading, canEdit }: {
  title: string; kind: Enums<'entry_kind'>; productionId: string; entries: Entry[]; loading: boolean; canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const remove = useSoftDeleteEntry();
  const total = entries.reduce((s, e) => s + Number(e.amount), 0);

  async function onRemove(e: Entry) {
    if (!window.confirm(`למחוק את הרשומה "${e.category}" בסך ${formatILS(e.amount)}?`)) return;
    await remove.mutateAsync(e.id);
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg">{title} <span className="text-sm text-soft">· {formatILS(total)}</span></h2>
        {canEdit && <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => setAdding((v) => !v)}>{adding ? 'סגירה' : `${title === 'הוצאות' ? 'הוצאה' : 'הכנסה'} חדשה`}</button>}
      </div>
      {adding && <EntryForm kind={kind} productionId={productionId} onDone={() => setAdding(false)} />}
      {loading ? (
        <CardSkeleton rows={3} />
      ) : entries.length === 0 ? (
        <EmptyState title={`אין ${title} להפקה הזו`} />
      ) : (
        <div className="card table-wrap">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="border-b border-rule text-right text-soft">
              <tr>
                {ENTRY_COLUMNS.map((c) => <th key={c.label} className={`px-3 py-2 font-medium ${c.numeric ? 'text-left' : ''}`}>{c.label}</th>)}
                {canEdit && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-rule last:border-0">
                  {ENTRY_COLUMNS.map((c) => (
                    <td key={c.label} className={`px-3 py-2 ${c.numeric ? 'text-left tabular-nums' : ''}`} dir={c.numeric ? 'ltr' : undefined}>
                      {c.numeric ? formatILS(e.amount) : String(c.value(e) || '—')}
                    </td>
                  ))}
                  {canEdit && (
                    <td className="px-3 py-2 text-left">
                      <button type="button" className="text-xs text-soft hover:text-bad" onClick={() => void onRemove(e)} disabled={remove.isPending}>מחיקה</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EntryForm({ kind, productionId, onDone }: { kind: Enums<'entry_kind'>; productionId: string; onDone: () => void }) {
  const add = useAddLedgerEntry();
  const season = useCurrentSeasonId();
  const categories = useCategories('production', kind);
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [vendor, setVendor] = useState('');
  const [description, setDescription] = useState('');
  const [method, setMethod] = useState<Enums<'payment_method'>>('transfer');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const a = Number(amount);
    if (!category.trim()) { setError('יש לבחור קטגוריה.'); return; }
    if (!Number.isFinite(a) || a <= 0) { setError('הסכום חייב להיות גדול מאפס.'); return; }
    if (!season.data) { setError('אין עונה נוכחית מוגדרת.'); return; }
    try {
      await add.mutateAsync({
        season_id: season.data, kind, scope: 'production', entry_date: date, category: category.trim(),
        vendor: vendor.trim() || null, description: description.trim() || null, amount: a, method,
        production_id: productionId,
      });
      onDone();
    } catch (err) {
      setError(humanError(err));
    }
  }

  const cats = categories.data ?? [];
  return (
    <form onSubmit={onSubmit} className="card mb-3 p-4">
      <div className="grid gap-3 md:grid-cols-6">
        <label className="block text-sm md:col-span-2">קטגוריה
          {cats.length > 0 ? (
            <select className="field mt-1" value={category} onChange={(e) => setCategory(e.target.value)} required>
              <option value="">— בחרי —</option>
              {cats.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          ) : (
            <input className="field mt-1" value={category} onChange={(e) => setCategory(e.target.value)} required />
          )}
        </label>
        <label className="block text-sm">סכום
          <input type="number" min="0" step="0.01" className="field mt-1" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </label>
        <label className="block text-sm">תאריך
          <input type="date" className="field mt-1" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="block text-sm">{kind === 'expense' ? 'ספק' : 'מקור'}
          <input className="field mt-1" value={vendor} onChange={(e) => setVendor(e.target.value)} />
        </label>
        <label className="block text-sm">אמצעי
          <select className="field mt-1" value={method} onChange={(e) => setMethod(e.target.value as Enums<'payment_method'>)}>
            {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="block text-sm md:col-span-6">תיאור
          <input className="field mt-1" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
      </div>
      {error && <p className="mt-3 text-sm text-bad" role="alert">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button type="submit" className="btn-primary" disabled={add.isPending}>{add.isPending ? 'שומרת…' : 'שמירה'}</button>
        <button type="button" className="btn-ghost" onClick={onDone}>ביטול</button>
      </div>
    </form>
  );
}

/**
 * משתתפות. הבורר מציג תלמידות בלי אישור צילום כחסומות ומסביר למה;
 * הטריגר במסד חוסם גם אם מישהו יעקוף את המסך.
 */
function CastSection({ productionId, cast, loading, canEdit }: {
  productionId: string; cast: ReturnType<typeof useProductionCast>['data'] & object; loading: boolean; canEdit: boolean;
}) {
  const students = useStudents();
  const addCast = useAddCast();
  const removeCast = useRemoveCast();
  const [studentId, setStudentId] = useState('');
  const [role, setRole] = useState('');
  const [error, setError] = useState<string | null>(null);

  const inCast = new Set(cast.map((c) => c.student_id));
  const candidates = (students.data ?? [])
    .filter((s): s is typeof s & { id: string; full_name: string } => Boolean(s.id && s.full_name))
    .filter((s) => !inCast.has(s.id) && s.status === 'active');
  const chosen = candidates.find((s) => s.id === studentId);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!chosen) { setError('יש לבחור תלמידה.'); return; }
    if (!chosen.photo_consent) { setError(`ל${chosen.full_name} אין אישור צילום — אי אפשר לצרף אותה להפקה.`); return; }
    try {
      await addCast.mutateAsync({ production_id: productionId, student_id: chosen.id, role_name: role.trim() || null });
      setStudentId(''); setRole('');
    } catch (err) {
      setError(/photo_consent|אישור צילום/i.test(String(err)) ? 'המסד חסם: אין אישור צילום.' : humanError(err));
    }
  }

  return (
    <section>
      <h2 className="mb-2 text-lg">משתתפות <span className="text-sm text-soft">· {cast.length}</span></h2>
      {canEdit && (
        <form onSubmit={onAdd} className="card mb-3 flex flex-wrap items-end gap-2 p-3">
          <label className="block text-sm">תלמידה
            <select className="field mt-1" value={studentId} onChange={(e) => setStudentId(e.target.value)} aria-label="בחירת תלמידה">
              <option value="">— בחרי —</option>
              {candidates.map((s) => (
                <option key={s.id} value={s.id} disabled={!s.photo_consent}>
                  {s.full_name} · {s.branch_name}{s.photo_consent ? '' : ' — אין אישור צילום'}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">תפקיד
            <input className="field mt-1" value={role} onChange={(e) => setRole(e.target.value)} placeholder="שחקנית ראשית" />
          </label>
          <button type="submit" className="btn-primary" disabled={addCast.isPending}>צירוף</button>
          {error && <p className="w-full text-sm text-bad" role="alert">{error}</p>}
        </form>
      )}
      {loading ? (
        <CardSkeleton rows={2} />
      ) : cast.length === 0 ? (
        <EmptyState title="עדיין אין משתתפות" hint="רק תלמידות עם אישור צילום ניתנות לצירוף." />
      ) : (
        <ul className="card divide-y divide-rule">
          {cast.map((c) => (
            <li key={c.student_id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <div>
                <span className="font-medium">{c.students?.full_name ?? '—'}</span>
                <span className="text-soft"> · {c.students?.branches?.name ?? ''}{c.role_name ? ` · ${c.role_name}` : ''}</span>
              </div>
              {canEdit && (
                <button type="button" className="text-xs text-soft hover:text-bad" disabled={removeCast.isPending}
                  onClick={() => { if (window.confirm(`להסיר את ${c.students?.full_name} מההפקה?`)) void removeCast.mutateAsync({ production_id: productionId, student_id: c.student_id }); }}>
                  הסרה
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NotesEditor({ notes, onSave }: { notes: string; onSave: (v: string) => Promise<unknown> }) {
  const [draft, setDraft] = useState(notes);
  const dirty = draft !== notes;
  return (
    <section className="card p-4">
      <h2 className="mb-2 text-lg">הערות</h2>
      <textarea className="field min-h-[5rem]" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="הערות להפקה" />
      {dirty && <button type="button" className="btn-primary mt-2" onClick={() => void onSave(draft)}>שמירת הערות</button>}
    </section>
  );
}
