import { useMemo, useState } from 'react';
import { useStudents, STATUS_LABEL, STATUS_TONE, type StudentStatus } from '@/hooks/students';
import { useBranches } from '@/hooks/queries';
import { StudentDrawer } from '@/components/StudentDrawer';
import { formatILS, formatPhone } from '@/lib/format';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/States';
import type { Views } from '@/lib/database.types';

type Student = Views<'v_student_overview'>;
type SortKey = 'full_name' | 'branch_name' | 'grade' | 'due' | 'paid' | 'balance' | 'attendance_pct';

const COLUMNS: { key: SortKey | null; label: string }[] = [
  { key: 'full_name', label: 'שם' },
  { key: 'branch_name', label: 'סניף' },
  { key: 'grade', label: 'כיתה' },
  { key: null, label: 'הורה' },
  { key: null, label: 'טלפון' },
  { key: 'due', label: 'אמורה' },
  { key: 'paid', label: 'שילמה' },
  { key: 'balance', label: 'יתרה' },
  { key: null, label: 'סטטוס' },
  { key: 'attendance_pct', label: 'נוכחות' },
];

export function Students() {
  const students = useStudents();
  const branches = useBranches();

  const [search, setSearch] = useState('');
  const [branchId, setBranchId] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'full_name', dir: 'asc' });
  const [selected, setSelected] = useState<Student | null>(null);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = (students.data ?? []).filter((s) => {
      if (branchId && s.branch_id !== branchId) return false;
      if (status && s.status !== status) return false;
      if (!term) return true;
      return [s.full_name, s.parent_name, s.parent_phone, s.grade, s.branch_name]
        .some((v) => v?.toLowerCase().includes(term));
    });

    return [...filtered].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv), 'he');
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [students.data, search, branchId, status, sort]);

  if (students.isError) return <ErrorState error={students.error} onRetry={() => void students.refetch()} />;

  const toggleSort = (key: SortKey) =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl">תלמידות</h1>
        <p className="text-sm text-soft">
          {students.isLoading ? 'טוען…' : `${rows.length} מתוך ${students.data?.length ?? 0}`}
        </p>
      </header>

      <div className="grid gap-2 sm:grid-cols-3">
        <input
          type="search"
          className="field"
          placeholder="חיפוש לפי שם, הורה או טלפון"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="חיפוש תלמידות"
        />
        <select className="field" value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label="סינון לפי סניף">
          <option value="">כל הסניפים</option>
          {(branches.data ?? []).map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <select className="field" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="סינון לפי סטטוס">
          <option value="">כל הסטטוסים</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {students.isLoading ? (
        <CardSkeleton rows={8} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="אין תלמידות שמתאימות לסינון"
          hint={search || branchId || status ? 'אפשר לנקות את הסינון ולנסות שוב.' : 'עדיין לא נוספו תלמידות.'}
        />
      ) : (
        <div className="card table-wrap">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="border-b border-rule text-right text-soft">
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c.label} className="px-3 py-2 font-medium">
                    {c.key ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key as SortKey)}
                        className="hover:text-ink"
                        aria-label={`מיון לפי ${c.label}`}
                      >
                        {c.label}
                        {sort.key === c.key && <span aria-hidden>{sort.dir === 'asc' ? ' ↑' : ' ↓'}</span>}
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr
                  key={s.id}
                  className="cursor-pointer border-b border-rule last:border-0 hover:bg-shade"
                  onClick={() => setSelected(s)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelected(s);
                    }
                  }}
                >
                  <td className="px-3 py-2 text-plum">{s.full_name}</td>
                  <td className="px-3 py-2">{s.branch_name}</td>
                  <td className="px-3 py-2">{s.grade ?? '—'}</td>
                  <td className="px-3 py-2">{s.parent_name ?? '—'}</td>
                  <td className="px-3 py-2" dir="ltr">{formatPhone(s.parent_phone)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatILS(s.due)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatILS(s.paid)}</td>
                  <td className={`px-3 py-2 tabular-nums ${Number(s.balance ?? 0) > 0 ? 'text-bad' : 'text-ok'}`}>
                    {formatILS(s.balance)}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_TONE[(s.status ?? 'active') as StudentStatus]}`}>
                      {STATUS_LABEL[(s.status ?? 'active') as StudentStatus]}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {s.attendance_pct === null ? '—' : `${s.attendance_pct}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <StudentDrawer student={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
