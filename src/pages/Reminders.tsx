import { useMemo, useState } from 'react';
import {
  useReminders, useMessageTemplates, useUpdateTemplate,
  useAutomations, useSetAutomation, useScheduleReminder, useCancelReminder,
} from '@/hooks/reminders';
import { useStudents } from '@/hooks/students';
import { formatDate, formatPhone, formatILS, normalizePhone } from '@/lib/format';
import { renderTemplate, usedVariables, TEMPLATE_VARIABLES } from '@/lib/template';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/States';
import { humanError } from '@/lib/errors';
import type { Enums } from '@/lib/database.types';

const STATUS_LABEL: Record<Enums<'reminder_status'>, string> = {
  scheduled: 'בתור', sent: 'נשלחה', cancelled: 'בוטלה', failed: 'נכשלה',
};
const STATUS_TONE: Record<Enums<'reminder_status'>, string> = {
  scheduled: 'bg-warn/15 text-warn', sent: 'bg-ok/15 text-ok',
  cancelled: 'bg-shade text-soft', failed: 'bg-bad/15 text-bad',
};

const AUTOMATIONS: { key: string; label: string; hint: string }[] = [
  { key: 'debt_reminders',   label: 'תזכורות גבייה',    hint: '08:30 · פעם אחת לכל סף של 30/60/90 יום' },
  { key: 'attendance_nudge', label: 'תזכורת לאחראית',   hint: 'כל 30 דקות · שיעור שלא דווח' },
  { key: 'absence_alerts',   label: 'התראת נשירה',      hint: '20:00 · שלוש היעדרויות רצופות' },
  { key: 'daily_summary',    label: 'סיכום יומי',       hint: 'לפי השעה שבהגדרות' },
  { key: 'weekly_summary',   label: 'סיכום שבועי',      hint: 'ראשון 09:00' },
];

type Tab = 'log' | 'new' | 'automations' | 'templates';

export function Reminders() {
  const [tab, setTab] = useState<Tab>('log');
  const reminders = useReminders();

  const pending = (reminders.data ?? []).filter((r) => r.status === 'scheduled').length;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl">תזכורות</h1>
        {pending > 0 && <p className="text-sm text-warn">{pending} ממתינות בתור</p>}
      </header>

      <nav className="flex flex-wrap gap-1 border-b border-rule" aria-label="טאבים">
        {([
          ['log', 'יומן שליחות'], ['new', 'תזכורת חדשה'],
          ['automations', 'אוטומציות'], ['templates', 'תבניות'],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key} type="button" onClick={() => setTab(key)}
            aria-current={tab === key ? 'page' : undefined}
            className={[
              'px-3 py-2 text-sm',
              tab === key ? 'border-b-2 border-rose font-medium text-ink' : 'text-soft hover:text-ink',
            ].join(' ')}
          >{label}</button>
        ))}
      </nav>

      {tab === 'log' && <Log />}
      {tab === 'new' && <NewReminder />}
      {tab === 'automations' && <AutomationToggles />}
      {tab === 'templates' && <TemplateEditor />}
    </div>
  );
}

function Log() {
  const reminders = useReminders();
  const cancel = useCancelReminder();
  const [filter, setFilter] = useState('');

  if (reminders.isError) return <ErrorState error={reminders.error} onRetry={() => void reminders.refetch()} />;
  if (reminders.isLoading) return <CardSkeleton rows={8} />;

  const rows = (reminders.data ?? []).filter((r) => !filter || r.status === filter);
  if (rows.length === 0) {
    return <EmptyState title="אין עדיין תזכורות" hint="תזכורות נוצרות מהגבייה, מהאוטומציות, או ידנית." />;
  }

  return (
    <div className="space-y-3">
      <select className="field w-auto" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="סינון לפי סטטוס">
        <option value="">כל הסטטוסים</option>
        {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>

      <div className="card table-wrap">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="border-b border-rule text-right text-soft">
            <tr>
              <th className="px-3 py-2 font-medium">מועד</th>
              <th className="px-3 py-2 font-medium">נמען</th>
              <th className="px-3 py-2 font-medium">הודעה</th>
              <th className="px-3 py-2 font-medium">סטטוס</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-rule last:border-0 align-top">
                <td className="whitespace-nowrap px-3 py-2">{formatDate(r.scheduled_at)}</td>
                <td className="px-3 py-2">
                  {r.to_label ?? '—'}
                  <span className="block text-xs text-soft" dir="ltr">{formatPhone(r.to_phone)}</span>
                </td>
                <td className="max-w-md px-3 py-2 text-soft">{r.body}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_TONE[r.status]}`}>
                    {STATUS_LABEL[r.status]}
                  </span>
                  {r.error && <span className="block text-xs text-bad">{r.error}</span>}
                </td>
                <td className="px-3 py-2">
                  {r.status === 'scheduled' && (
                    <button type="button" className="text-xs text-soft hover:text-bad"
                            onClick={() => void cancel.mutateAsync(r.id)}>
                      ביטול
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-soft">
        סטטוס אפשרי: בתור · נשלחה · נכשלה. אין "נמסרה" — שרת הוואטסאפ אינו מדווח אישורי מסירה.
      </p>
    </div>
  );
}

function NewReminder() {
  const students = useStudents();
  const templates = useMessageTemplates();
  const schedule = useScheduleReminder();

  const [studentId, setStudentId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [body, setBody] = useState('');
  const [when, setWhen] = useState(() => new Date(Date.now() + 3600_000).toISOString().slice(0, 16));
  const [done, setDone] = useState(false);

  const student = (students.data ?? []).find((s) => s.id === studentId);
  const template = (templates.data ?? []).find((t) => t.id === templateId);

  const vars = useMemo(() => ({
    student_name: student?.full_name ?? '',
    parent_name: student?.parent_name ?? '',
    branch: student?.branch_name ?? '',
    balance: formatILS(student?.balance),
    total: formatILS(student?.due),
    paid: formatILS(student?.paid),
    date: formatDate(new Date()),
  }), [student]);

  const source = body || template?.body || '';
  const preview = renderTemplate(source, vars);
  const canSend = Boolean(student?.parent_phone && preview);

  if (done) {
    return (
      <EmptyState
        title="התזכורת נכנסה לתור"
        hint="היא תישלח במועד שנקבע, בכפוף לשעות שקטות ולזמינות החיבור."
        action={<button type="button" className="btn-ghost" onClick={() => setDone(false)}>תזכורת נוספת</button>}
      />
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card space-y-3 p-4">
        <label className="block text-sm">
          <span className="text-soft">תלמידה</span>
          <select className="field mt-1" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">בחרי תלמידה</option>
            {(students.data ?? []).map((s) => (
              <option key={s.id} value={s.id ?? ''}>{s.full_name} · {s.branch_name}</option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="text-soft">תבנית</span>
          <select
            className="field mt-1" value={templateId}
            onChange={(e) => { setTemplateId(e.target.value); setBody(''); }}
          >
            <option value="">ללא תבנית — טקסט חופשי</option>
            {(templates.data ?? []).filter((t) => t.is_active).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="text-soft">טקסט ההודעה</span>
          <textarea
            className="field mt-1 min-h-[7rem]"
            value={body || template?.body || ''}
            onChange={(e) => setBody(e.target.value)}
            placeholder="אפשר להשתמש במשתנים, למשל {parent_name}"
          />
        </label>

        <p className="text-xs text-soft">
          משתנים זמינים: {TEMPLATE_VARIABLES.map((v) => `{${v}}`).join(' · ')}
        </p>

        <label className="block text-sm">
          <span className="text-soft">מועד שליחה</span>
          <input type="datetime-local" className="field mt-1" value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>

        {schedule.error != null && (
          <p className="text-sm text-bad" role="alert">{humanError(schedule.error)}</p>
        )}

        <button
          type="button" className="btn-primary w-full" disabled={!canSend || schedule.isPending}
          onClick={async () => {
            if (!student?.parent_phone || !student.id) return;
            await schedule.mutateAsync({
              kind: 'general',
              student_id: student.id,
              branch_id: student.branch_id,
              to_phone: normalizePhone(student.parent_phone),
              to_label: `${student.parent_name ?? ''} · ${student.full_name ?? ''}`.trim(),
              body: preview,
              scheduled_at: new Date(when).toISOString(),
            });
            setDone(true);
          }}
        >
          {schedule.isPending ? 'שומר…' : 'הוספה לתור'}
        </button>
        {!student?.parent_phone && studentId && (
          <p className="text-xs text-warn">לתלמידה הזו אין טלפון הורה במערכת.</p>
        )}
      </div>

      <div className="card p-4">
        <h2 className="mb-2 text-sm font-medium text-soft">כך ההודעה תיראה</h2>
        {preview ? (
          <div className="rounded-field bg-shade p-3 text-sm">
            <p className="whitespace-pre-wrap">{preview}</p>
          </div>
        ) : (
          <p className="text-sm text-soft">בחרי תלמידה ותבנית כדי לראות תצוגה מקדימה.</p>
        )}
        {source && usedVariables(source).length > 0 && (
          <p className="mt-2 text-xs text-soft">
            משתנים בשימוש: {usedVariables(source).map((v) => `{${v}}`).join(' · ')}
          </p>
        )}
      </div>
    </div>
  );
}

function AutomationToggles() {
  const automations = useAutomations();
  const setAutomation = useSetAutomation();
  const current = automations.data ?? {};

  if (automations.isLoading) return <CardSkeleton rows={5} />;

  return (
    <ul className="card divide-y divide-rule">
      {AUTOMATIONS.map((a) => {
        const enabled = current[a.key] !== false;
        return (
          <li key={a.key} className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-sm">{a.label}</p>
              <p className="text-xs text-soft">{a.hint}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label={a.label}
              disabled={setAutomation.isPending}
              onClick={() => void setAutomation.mutateAsync({ current, name: a.key, enabled: !enabled })}
              className={[
                'relative h-6 w-11 shrink-0 rounded-full transition-colors',
                enabled ? 'bg-ok' : 'bg-rule',
              ].join(' ')}
            >
              <span
                className={[
                  'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all',
                  enabled ? 'right-0.5' : 'right-[1.375rem]',
                ].join(' ')}
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function TemplateEditor() {
  const templates = useMessageTemplates();
  const update = useUpdateTemplate();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  if (templates.isLoading) return <CardSkeleton rows={6} />;

  return (
    <div className="space-y-3">
      {(templates.data ?? []).map((t) => {
        const isEditing = editing === t.id;
        return (
          <div key={t.id} className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{t.name}</p>
                <code className="text-xs text-soft">{t.key}</code>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-soft">
                  <input
                    type="checkbox" checked={t.is_active}
                    onChange={() => void update.mutateAsync({ id: t.id, body: t.body, is_active: !t.is_active })}
                  />
                  פעילה
                </label>
                <button
                  type="button" className="btn-ghost px-2 py-1 text-xs"
                  onClick={() => { setEditing(isEditing ? null : t.id); setDraft(t.body); }}
                >
                  {isEditing ? 'סגירה' : 'עריכה'}
                </button>
              </div>
            </div>

            {isEditing ? (
              <div className="mt-3 space-y-2">
                <textarea className="field min-h-[6rem]" value={draft} onChange={(e) => setDraft(e.target.value)} />
                <p className="text-xs text-soft">
                  משתנים בשימוש: {usedVariables(draft).map((v) => `{${v}}`).join(' · ') || 'אין'}
                </p>
                <div className="rounded-field bg-shade p-2 text-xs">
                  <span className="text-soft">תצוגה עם ערכים לדוגמה:</span>
                  <p className="mt-1 whitespace-pre-wrap">
                    {renderTemplate(draft, {
                      student_name: 'שירה', parent_name: 'רחלי כהן', branch: 'ביתר עילית',
                      balance: '₪1,300', total: '₪2,000', paid: '₪700',
                      date: '02/09/2026', lesson_date: '02/09/2026', link: 'https://…/a/abc',
                    })}
                  </p>
                </div>
                <button
                  type="button" className="btn-primary px-3 py-1.5 text-sm" disabled={update.isPending}
                  onClick={async () => {
                    await update.mutateAsync({ id: t.id, body: draft, is_active: t.is_active });
                    setEditing(null);
                  }}
                >
                  {update.isPending ? 'שומר…' : 'שמירה'}
                </button>
              </div>
            ) : (
              <p className="mt-2 whitespace-pre-wrap text-sm text-soft">{t.body}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
