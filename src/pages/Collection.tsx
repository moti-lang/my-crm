import { useMemo, useState } from 'react';
import { useDebtors, useTemplates, useCreateReminders } from '@/hooks/finance';
import { useBranches } from '@/hooks/queries';
import { formatILS, formatPhone, formatDate, formatPercent } from '@/lib/format';
import { renderTemplate } from '@/lib/template';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/States';
import { useBranchPnl } from '@/hooks/queries';

const AGING_TONE: Record<number, string> = {
  0:  'bg-shade text-soft',
  30: 'bg-warn/15 text-warn',
  60: 'bg-bad/10 text-bad',
  90: 'bg-bad/20 text-bad font-medium',
};
const AGING_LABEL: Record<number, string> = {
  0: 'עד 30 יום', 30: '30+ ימים', 60: '60+ ימים', 90: '90+ ימים',
};

export function Collection() {
  const debtors = useDebtors();
  const branches = useBranches();
  const pnl = useBranchPnl();
  const templates = useTemplates();
  const createReminders = useCreateReminders();

  const [branchId, setBranchId] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState(false);
  const [templateKey, setTemplateKey] = useState('debt_reminder');

  const rows = useMemo(
    () => (debtors.data ?? []).filter((d) => !branchId || d.branch_id === branchId),
    [debtors.data, branchId],
  );

  const collected = (pnl.data ?? []).reduce((s, p) => s + Number(p.income_students ?? 0), 0);
  const outstanding = rows.reduce((s, d) => s + Number(d.balance ?? 0), 0);
  const totalDue = collected + (debtors.data ?? []).reduce((s, d) => s + Number(d.balance ?? 0), 0);
  const rate = totalDue > 0 ? (collected / totalDue) * 100 : 0;

  const template = (templates.data ?? []).find((t) => t.key === templateKey);
  const chosen = rows.filter((d) => d.student_id && selected.has(d.student_id));

  const messages = chosen.map((d) => ({
    debtor: d,
    body: renderTemplate(template?.body ?? '', {
      student_name: d.full_name ?? '',
      parent_name: d.parent_name ?? '',
      branch: d.branch_name ?? '',
      balance: formatILS(d.balance),
      total: formatILS(d.due),
      paid: formatILS(d.paid),
      date: formatDate(new Date()),
    }),
  }));

  async function send() {
    const now = new Date().toISOString();
    await createReminders.mutateAsync(
      messages
        .filter((m) => m.debtor.parent_phone && m.debtor.student_id)
        .map((m) => ({
          kind: 'debt' as const,
          student_id: m.debtor.student_id as string,
          branch_id: m.debtor.branch_id,
          to_phone: m.debtor.parent_phone as string,
          to_label: `${m.debtor.parent_name ?? ''} · ${m.debtor.full_name ?? ''}`.trim(),
          body: m.body,
          scheduled_at: now,
        })),
    );
    setSelected(new Set());
    setPreview(false);
  }

  if (debtors.isError) return <ErrorState error={debtors.error} onRetry={() => void debtors.refetch()} />;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const allSelected = rows.length > 0 && rows.every((d) => d.student_id && selected.has(d.student_id));

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl">גבייה</h1>
        <select className="field w-auto" value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label="סינון לפי סניף">
          <option value="">כל הסניפים</option>
          {(branches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </header>

      <div className="grid grid-cols-3 gap-3">
        <Kpi label="נגבה" value={formatILS(collected)} tone="text-ok" />
        <Kpi label="נותר" value={formatILS(outstanding)} tone="text-bad" />
        <Kpi label="אחוז גבייה" value={formatPercent(rate)} />
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-card border border-plum/30 bg-shade p-3">
          <span className="text-sm">{selected.size} נבחרו</span>
          <select className="field w-auto" value={templateKey} onChange={(e) => setTemplateKey(e.target.value)} aria-label="תבנית ההודעה">
            {(templates.data ?? []).map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
          </select>
          <button type="button" className="btn-primary" onClick={() => setPreview(true)}>
            שליחת תזכורת לנבחרות
          </button>
          <button type="button" className="btn-ghost" onClick={() => setSelected(new Set())}>ניקוי</button>
        </div>
      )}

      {debtors.isLoading ? (
        <CardSkeleton rows={8} />
      ) : rows.length === 0 ? (
        <EmptyState title="אין חובות פתוחים" hint="כל התלמידות שילמו במלואן." />
      ) : (
        <div className="card table-wrap">
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="border-b border-rule text-right text-soft">
              <tr>
                <th className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((d) => d.student_id as string)))}
                    aria-label="בחירת הכל"
                  />
                </th>
                <th className="px-3 py-2 font-medium">תלמידה</th>
                <th className="px-3 py-2 font-medium">סניף</th>
                <th className="px-3 py-2 font-medium">הורה</th>
                <th className="px-3 py-2 font-medium">טלפון</th>
                <th className="px-3 py-2 font-medium">חוב</th>
                <th className="px-3 py-2 font-medium">ותק החוב</th>
                <th className="px-3 py-2 font-medium">תשלום אחרון</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.student_id} className="border-b border-rule last:border-0 hover:bg-shade">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={Boolean(d.student_id && selected.has(d.student_id))}
                      onChange={() => d.student_id && toggle(d.student_id)}
                      aria-label={`בחירת ${d.full_name}`}
                    />
                  </td>
                  <td className="px-3 py-2">{d.full_name}</td>
                  <td className="px-3 py-2">{d.branch_name}</td>
                  <td className="px-3 py-2">{d.parent_name ?? '—'}</td>
                  <td className="px-3 py-2" dir="ltr">{formatPhone(d.parent_phone)}</td>
                  <td className="px-3 py-2 tabular-nums text-bad">{formatILS(d.balance)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${AGING_TONE[d.aging_bucket ?? 0]}`}>
                      {AGING_LABEL[d.aging_bucket ?? 0]} · {d.days_outstanding} ימים
                    </span>
                  </td>
                  <td className="px-3 py-2">{d.last_paid_on ? formatDate(d.last_paid_on) : 'טרם שילמה'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {preview && (
        <PreviewDialog
          messages={messages}
          busy={createReminders.isPending}
          error={createReminders.error}
          onCancel={() => setPreview(false)}
          onConfirm={() => void send()}
        />
      )}
    </div>
  );
}

function PreviewDialog({
  messages, busy, error, onCancel, onConfirm,
}: {
  messages: { debtor: { full_name: string | null; parent_phone: string | null }; body: string }[];
  busy: boolean;
  error: unknown;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const missingPhone = messages.filter((m) => !m.debtor.parent_phone).length;

  return (
    <>
      <div className="fixed inset-0 z-30 bg-ink/30" onClick={onCancel} role="presentation" />
      <div
        className="fixed inset-x-4 top-10 bottom-10 z-40 mx-auto flex max-w-lg flex-col rounded-card bg-card shadow-pop"
        role="dialog" aria-modal="true" aria-label="תצוגה מקדימה של ההודעות"
      >
        <header className="border-b border-rule p-4">
          <h2 className="font-display text-lg">תצוגה מקדימה · {messages.length} הודעות</h2>
          <p className="mt-0.5 text-sm text-soft">כך תיראה כל הודעה אצל ההורה.</p>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {missingPhone > 0 && (
            <p className="rounded-field border border-warn/40 bg-warn/10 p-2 text-sm text-warn">
              ל-{missingPhone} תלמידות אין טלפון הורה — הן לא ייכללו בשליחה.
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className="rounded-field border border-rule p-3">
              <p className="text-xs text-soft">
                {m.debtor.full_name} ·{' '}
                <span dir="ltr">{m.debtor.parent_phone ? formatPhone(m.debtor.parent_phone) : 'אין טלפון'}</span>
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{m.body}</p>
            </div>
          ))}
        </div>

        <footer className="border-t border-rule p-4">
          {error != null && (
            <p className="mb-2 text-sm text-bad" role="alert">
              {error instanceof Error ? error.message : 'השמירה נכשלה.'}
            </p>
          )}
          <p className="mb-3 text-xs text-soft">
            התזכורות נשמרות בתור. השליחה בפועל מתבצעת ע"י cron-reminders, ומכבדת שעות שקטות.
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn-primary flex-1" onClick={onConfirm} disabled={busy}>
              {busy ? 'שומר…' : `אישור ושליחה (${messages.filter((m) => m.debtor.parent_phone).length})`}
            </button>
            <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>ביטול</button>
          </div>
        </footer>
      </div>
    </>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-soft">{label}</p>
      <p className={`mt-1 font-display text-xl tabular-nums ${tone ?? 'text-ink'}`}>{value}</p>
    </div>
  );
}
