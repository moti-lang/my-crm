import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useBranch, useStudents, STATUS_LABEL, STATUS_TONE, type StudentStatus } from '@/hooks/students';
import { useBranchPnl } from '@/hooks/queries';
import { StudentDrawer } from '@/components/StudentDrawer';
import { formatILS, formatPhone, formatWeekdays } from '@/lib/format';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/States';
import type { Views } from '@/lib/database.types';

type Student = Views<'v_student_overview'>;
type Tab = 'overview' | 'students' | 'settings';

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'סקירה' },
  { key: 'students', label: 'תלמידות' },
  { key: 'settings', label: 'הגדרות' },
];

export function BranchDetail() {
  const { id } = useParams<{ id: string }>();
  const branch = useBranch(id);
  const pnl = useBranchPnl();
  const students = useStudents();
  const [tab, setTab] = useState<Tab>('overview');
  const [selected, setSelected] = useState<Student | null>(null);

  if (branch.isError) return <ErrorState error={branch.error} onRetry={() => void branch.refetch()} />;
  if (branch.isLoading) return <CardSkeleton rows={6} />;
  if (!branch.data) {
    return (
      <EmptyState
        title="הסניף לא נמצא"
        hint="ייתכן שהוא נמחק, או שאינו משויך אלייך."
        action={<Link to="/branches" className="btn-ghost">חזרה לסניפים</Link>}
      />
    );
  }

  const b = branch.data;
  const p = (pnl.data ?? []).find((x) => x.branch_id === id);
  const income = Number(p?.income_students ?? 0) + Number(p?.income_other ?? 0);
  const expenses = Number(p?.expenses ?? 0);
  const branchStudents = (students.data ?? []).filter((s) => s.branch_id === id);

  return (
    <div className="space-y-4">
      <header>
        <Link to="/branches" className="text-sm text-soft hover:text-ink">← כל הסניפים</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl">{b.name}</h1>
          <span className={`rounded-full px-2 py-0.5 text-xs ${b.is_active ? 'bg-ok/15 text-ok' : 'bg-shade text-soft'}`}>
            {b.is_active ? 'פעיל' : 'לא פעיל'}
          </span>
        </div>
        <p className="mt-0.5 text-sm text-soft">
          {[b.address, b.city].filter(Boolean).join(', ') || 'ללא כתובת'}
        </p>
      </header>

      <nav className="flex gap-1 border-b border-rule" aria-label="טאבים">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? 'page' : undefined}
            className={[
              'px-3 py-2 text-sm transition-colors',
              tab === t.key ? 'border-b-2 border-rose font-medium text-ink' : 'text-soft hover:text-ink',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
        <span className="px-3 py-2 text-sm text-soft/60" title="נבנה בסבבים הבאים">
          גבייה · הוצאות · נוכחות
        </span>
      </nav>

      {tab === 'overview' && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="תלמידות פעילות" value={String(p?.active_students ?? 0)} />
          <Stat label="הכנסות" value={formatILS(income)} />
          <Stat label="הוצאות" value={formatILS(expenses)} />
          <Stat
            label="רווח"
            value={formatILS(income - expenses)}
            tone={income - expenses >= 0 ? 'text-ok' : 'text-bad'}
          />
          <Stat label="חוב פתוח" value={formatILS(p?.open_debt)} tone="text-warn" />
          <Stat label="שכירות חודשית" value={formatILS(b.monthly_rent)} />
          <Stat label="מחיר ברירת מחדל" value={formatILS(b.default_tuition)} />
          <Stat label="ימי פעילות" value={b.schedule_text ?? formatWeekdays(b.weekdays)} />
        </div>
      )}

      {tab === 'students' && (
        students.isLoading ? (
          <CardSkeleton rows={6} />
        ) : branchStudents.length === 0 ? (
          <EmptyState title="אין תלמידות בסניף הזה" />
        ) : (
          <div className="card table-wrap">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="border-b border-rule text-right text-soft">
                <tr>
                  <th className="px-3 py-2 font-medium">שם</th>
                  <th className="px-3 py-2 font-medium">כיתה</th>
                  <th className="px-3 py-2 font-medium">יתרה</th>
                  <th className="px-3 py-2 font-medium">נוכחות</th>
                  <th className="px-3 py-2 font-medium">סטטוס</th>
                </tr>
              </thead>
              <tbody>
                {branchStudents.map((s) => (
                  <tr
                    key={s.id}
                    className="cursor-pointer border-b border-rule last:border-0 hover:bg-shade"
                    onClick={() => setSelected(s)}
                  >
                    <td className="px-3 py-2 text-plum">{s.full_name}</td>
                    <td className="px-3 py-2">{s.grade ?? '—'}</td>
                    <td className={`px-3 py-2 tabular-nums ${Number(s.balance ?? 0) > 0 ? 'text-bad' : 'text-ok'}`}>
                      {formatILS(s.balance)}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {s.attendance_pct === null ? '—' : `${s.attendance_pct}%`}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_TONE[(s.status ?? 'active') as StudentStatus]}`}>
                        {STATUS_LABEL[(s.status ?? 'active') as StudentStatus]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {tab === 'settings' && (
        <div className="card space-y-3 p-4">
          <dl className="space-y-2 text-sm">
            <Row label="אחראית" value={b.supervisor_name} />
            <Row label="טלפון האחראית" value={formatPhone(b.supervisor_phone)} ltr />
            <Row label="ימים ושעות" value={b.schedule_text ?? formatWeekdays(b.weekdays)} />
            <Row label="שעת שיעור" value={b.lesson_time} />
            <Row label="מחיר ברירת מחדל" value={formatILS(b.default_tuition)} />
            <Row label="שכירות חודשית" value={formatILS(b.monthly_rent)} />
          </dl>
          <p className="border-t border-rule pt-3 text-xs text-soft">
            עריכת ההגדרות וכפתור "קישור נוכחות" נבנים בסבב 4.
          </p>
        </div>
      )}

      <StudentDrawer student={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-soft">{label}</p>
      <p className={`mt-1 font-display text-lg tabular-nums ${tone ?? 'text-ink'}`}>{value}</p>
    </div>
  );
}

function Row({ label, value, ltr }: { label: string; value: string | null; ltr?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="text-soft">{label}:</dt>
      <dd {...(ltr ? { dir: 'ltr' as const } : {})}>{value ?? '—'}</dd>
    </div>
  );
}
