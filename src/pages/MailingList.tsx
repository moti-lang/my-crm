import { useMemo, useState } from 'react';
import { useMailingList } from '@/hooks/enrollment';
import { exportXlsx, exportCsv } from '@/lib/export';
import { formatPhone } from '@/lib/format';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/States';
import type { Column } from '@/lib/export-core';

type Row = { full_name: string | null; parent_name: string | null; parent_phone: string | null; email: string | null; branch_name: string | null; status: string | null };
const COLS: Column<Row>[] = [
  { label: 'תלמידה', value: (r) => r.full_name },
  { label: 'הורה', value: (r) => r.parent_name },
  { label: 'טלפון', value: (r) => (r.parent_phone ? formatPhone(r.parent_phone) : null) },
  { label: 'מייל', value: (r) => r.email },
  { label: 'סניף', value: (r) => r.branch_name },
];

/** רשימת התפוצה: כל מי שאישרה בהרשמה. הבעלים בלבד (RLS בתצוגה). */
export function MailingList() {
  const list = useMailingList();
  const [q, setQ] = useState('');
  const rows = useMemo(() => (list.data ?? []).filter((r) => !q || [r.full_name, r.email, r.parent_phone, r.branch_name].some((v) => (v ?? '').includes(q))), [list.data, q]);
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div><h1 className="text-2xl">רשימת תפוצה</h1><p className="text-sm text-soft">מי שאישרה בהרשמה הצטרפות לרשימת התפוצה במייל ולקו החוג. מכאן יוצאים העדכונים.</p></div>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost" disabled={!rows.length} onClick={() => exportXlsx('רשימת-תפוצה', [{ name: 'רשימת תפוצה', columns: COLS as Column<unknown>[], rows }])}>אקסל</button>
          <button type="button" className="btn-ghost" disabled={!rows.length} onClick={() => exportCsv('רשימת-תפוצה', COLS, rows)}>CSV</button>
        </div>
      </header>
      <input className="field" placeholder="חיפוש לפי שם, מייל, טלפון או סניף" value={q} onChange={(e) => setQ(e.target.value)} aria-label="חיפוש" />
      {list.isLoading ? <CardSkeleton rows={6} /> : rows.length === 0 ? (
        <EmptyState title="עדיין אין נרשמות ברשימה" hint="הרשימה מתמלאת מדף ההרשמה, כשההורה מסמנת את תיבת ההסכמה." />
      ) : (
        <div className="card table-wrap">
          <p className="px-3 pt-2 text-xs text-soft">{rows.length} ברשימה</p>
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="border-b border-rule text-right text-soft"><tr>{COLS.map((c) => <th key={c.label} className="px-3 py-2 font-medium">{c.label}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i} className="border-b border-rule last:border-0">
                {COLS.map((c) => <td key={c.label} className="px-3 py-2" dir={c.label === 'טלפון' || c.label === 'מייל' ? 'ltr' : undefined}>{c.value(r) ?? '—'}</td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
