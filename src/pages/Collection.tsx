import { humanError } from '@/lib/errors';
import { useMemo, useState } from 'react';
import { useDebtors, useTemplates, useCreateReminders, useReconciliation, useCancelPaymentLink } from '@/hooks/finance';
import { PaymentLinkButton } from '@/components/PaymentLinkButton';
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
  const [view, setView] = useState<'debtors' | 'links'>('debtors');

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

      <nav className="flex gap-1" aria-label="חלקי המסך">
        {([['debtors', 'חייבות'], ['links', 'קישורי תשלום והתאמה']] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setView(k)} aria-pressed={view === k}
            className={`rounded-btn px-3 py-1.5 text-sm ${view === k ? 'bg-plum text-white' : 'border border-rule text-ink hover:bg-shade'}`}>{label}</button>
        ))}
      </nav>

      {view === 'links' && <Reconciliation branchId={branchId} />}

      {view === 'debtors' && (<>
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
                <th className="px-3 py-2 font-medium">קישור</th>
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
                  <td className="px-3 py-2" dir="ltr">
                    {d.parent_phone
                      ? formatPhone(d.parent_phone)
                      : <span dir="rtl" className="rounded-full bg-warn/15 px-2 py-0.5 text-xs text-warn" title="בלי טלפון לא נשלחת תזכורת. להשלים במסך התלמידות.">אין טלפון</span>}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-bad">{formatILS(d.balance)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${AGING_TONE[d.aging_bucket ?? 0]}`}>
                      {AGING_LABEL[d.aging_bucket ?? 0]} · {d.days_outstanding} ימים
                    </span>
                  </td>
                  <td className="px-3 py-2">{d.last_paid_on ? formatDate(d.last_paid_on) : 'טרם שילמה'}</td>
                  <td className="px-3 py-2">{d.student_id && <PaymentLinkButton studentId={d.student_id} balance={Number(d.balance ?? 0)} hasPhone={Boolean(d.parent_phone)} compact />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </>)}

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

// ─────────── קישורי תשלום והתאמה מול SUMIT ───────────
const LINK_STATUS: Record<string, string> = {
  pending: 'נשלח', opened: 'נפתח', paid: 'שולם', mismatch: 'שולם — סכום שונה', expired: 'פג', cancelled: 'בוטל',
};
function Reconciliation({ branchId }: { branchId: string }) {
  const links = useReconciliation();
  const cancel = useCancelPaymentLink();
  const rows = (links.data ?? []).filter((l) => !branchId || l.branch_id === branchId);
  const issues = rows.filter((l) => l.issue);
  if (links.isError) return <ErrorState error={links.error} onRetry={() => void links.refetch()} />;
  if (links.isLoading) return <CardSkeleton rows={5} />;
  if (rows.length === 0) return <EmptyState title="עדיין אין קישורי תשלום" hint='"קישור תשלום" ליד חייבת שולח להורה דף תשלום בכרטיס. מה שנקלט ב-SUMIT מופיע כאן מול מה שנרשם אצלנו.' />;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Kpi label="קישורים פתוחים" value={String(rows.filter((l) => ['pending', 'opened'].includes(l.status ?? '')).length)} />
        <Kpi label="שולמו" value={String(rows.filter((l) => ['paid', 'mismatch'].includes(l.status ?? '')).length)} tone="text-ok" />
        <Kpi label="הפרשים" value={String(issues.length)} tone={issues.length ? 'text-bad' : 'text-ok'} />
      </div>
      {issues.length > 0 && (
        <p className="rounded-card border border-bad/40 bg-bad/10 p-3 text-sm text-bad" role="alert">
          {issues.length} קישורים עם הפרש בין SUMIT לרישום אצלנו — מסומנים באדום למטה. כל אחד כזה קיבל גם התראה.
        </p>
      )}
      <div className="card table-wrap">
        <table className="w-full min-w-[56rem] text-sm">
          <thead className="border-b border-rule text-right text-soft">
            <tr>
              <th className="px-3 py-2 font-medium">תלמידה</th>
              <th className="px-3 py-2 font-medium">סניף</th>
              <th className="px-3 py-2 font-medium">נשלח</th>
              <th className="px-3 py-2 font-medium">סכום בקישור</th>
              <th className="px-3 py-2 font-medium">נקלט ב-SUMIT</th>
              <th className="px-3 py-2 font-medium">נרשם אצלנו</th>
              <th className="px-3 py-2 font-medium">מצב</th>
              <th className="px-3 py-2 font-medium">נבדק</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className={`border-b border-rule last:border-0 ${l.issue ? 'bg-bad/10' : ''}`}>
                <td className="px-3 py-2">{l.student_name}<span className="block text-xs text-soft">{l.parent_name ?? ''}</span></td>
                <td className="px-3 py-2">{l.branch_name}</td>
                <td className="px-3 py-2">{l.created_at ? formatDate(l.created_at) : ''}<span className="block text-xs text-soft">עד {l.expires_at ? formatDate(l.expires_at) : ''}</span></td>
                <td className="px-3 py-2 tabular-nums">{formatILS(l.link_amount)}</td>
                <td className="px-3 py-2 tabular-nums">{l.sumit_amount != null ? formatILS(l.sumit_amount) : '—'}{l.sumit_document_id ? <span className="block text-xs text-soft">קבלה {l.sumit_document_id}</span> : null}</td>
                <td className="px-3 py-2 tabular-nums">{l.recorded_amount != null ? formatILS(l.recorded_amount) : '—'}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${l.issue ? 'bg-bad text-white' : ['paid'].includes(l.status ?? '') ? 'bg-ok/15 text-ok' : 'bg-shade text-soft'}`}>
                    {l.issue ?? LINK_STATUS[l.status ?? ''] ?? l.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-soft">{l.last_checked_at ? formatDate(l.last_checked_at) : 'טרם'}</td>
                <td className="px-3 py-2">
                  {['pending', 'opened'].includes(l.status ?? '') && l.id && (
                    <button type="button" className="text-xs text-bad hover:underline" disabled={cancel.isPending}
                      onClick={() => { if (window.confirm('לבטל את הקישור? ההורה לא תוכל לשלם דרכו.')) void cancel.mutateAsync(l.id as string); }}>ביטול</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-soft">"נבדק" — מתי המערכת שאלה את SUMIT לאחרונה על הקישור (כל שעה, ומיד כשמגיע webhook). התשלום נרשם רק ממה ש-SUMIT מאשרת.</p>
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
              {humanError(error)}
            </p>
          )}
          <p className="mb-3 text-xs text-soft">
            התזכורות נשמרות בתור ונשלחות אוטומטית כל רבע שעה, בכפוף לשעות השקטות.
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
