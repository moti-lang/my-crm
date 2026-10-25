import { useMemo, useRef, useState } from 'react';
import { useMailingList } from '@/hooks/enrollment';
import { useStudents, STATUS_LABEL } from '@/hooks/students';
import { useBranches } from '@/hooks/queries';
import { useTemplates } from '@/hooks/finance';
import { useAuth } from '@/auth/AuthProvider';
import {
  useEmailStatus, useSuppressions, useEmailCampaigns, useEmailMessages, useEmailActions, fileToBase64,
  MESSAGE_STATUS, type Attachment,
} from '@/hooks/email';
import { exclusionOf, isPersonal, normEmail, SKIP_LABEL, type SkipReason } from '@/lib/emailRecipients';
import { renderTemplate } from '@/lib/template';
import { exportXlsx, exportCsv } from '@/lib/export';
import { formatDate, formatILS, formatPhone } from '@/lib/format';
import { humanError } from '@/lib/errors';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/States';
import type { Column } from '@/lib/export-core';

type Tab = 'compose' | 'log' | 'list';
const TABS: { id: Tab; label: string }[] = [
  { id: 'compose', label: 'שליחת מייל' },
  { id: 'log', label: 'יומן שליחות' },
  { id: 'list', label: 'רשימת התפוצה' },
];
const MAX_MB = 7;
const VAR_BUTTONS = ['שם ההורה', 'שם התלמידה', 'סניף', 'יתרה'] as const;

/** מיילים להורים: שליחה, יומן, ורשימת התפוצה. הבעלים בלבד. */
export function MailingList() {
  const [tab, setTab] = useState<Tab>('compose');
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl">מיילים להורים</h1>
        <p className="text-sm text-soft">נשלח רק למי שאישרה בהרשמה הצטרפות לתפוצה במייל. בתחתית כל מייל — קישור הסרה מהתפוצה.</p>
      </header>
      <nav className="flex gap-1 overflow-x-auto pb-1" aria-label="חלקי המסך">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} aria-pressed={tab === t.id}
            className={`shrink-0 rounded-btn px-3 py-1.5 text-sm ${tab === t.id ? 'bg-plum text-white' : 'border border-rule text-ink hover:bg-shade'}`}>
            {t.label}
          </button>
        ))}
      </nav>
      {tab === 'compose' && <Compose onSent={() => setTab('log')} />}
      {tab === 'log' && <Log />}
      {tab === 'list' && <ListTab />}
    </div>
  );
}

// ─────────── שליחה ───────────
function Compose({ onSent }: { onSent: () => void }) {
  const status = useEmailStatus();
  const students = useStudents();
  const branches = useBranches();
  const templates = useTemplates();
  const suppressions = useSuppressions();
  const actions = useEmailActions();
  const { session } = useAuth();

  const [branch, setBranch] = useState('');
  const [studentStatus, setStudentStatus] = useState('active');
  const [debt, setDebt] = useState('');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachment, setAttachment] = useState<(Attachment & { size: number }) | null>(null);
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const suppressed = suppressions.data ?? new Map<string, string>();
  const all = students.data ?? [];
  const filtered = useMemo(() => all.filter((s) => {
    if (branch && s.branch_id !== branch) return false;
    if (studentStatus && s.status !== studentStatus) return false;
    if (debt === 'owing' && !(Number(s.balance ?? 0) > 0)) return false;
    const t = q.trim().toLowerCase();
    return !t || [s.full_name, s.parent_name, s.email].some((v) => v?.toLowerCase().includes(t));
  }), [all, branch, studentStatus, debt, q]);

  const chosen = all.filter((s) => s.id && picked.has(s.id));
  const personal = isPersonal(subject, body);
  // מי תקבל בפועל — אותם כללים כמו בשרת (ההחלטה הסופית שם).
  const { willSend, excluded } = useMemo(() => {
    const out: typeof chosen = [], ex: Record<SkipReason, number> = { no_email: 0, no_consent: 0, unsubscribed: 0, duplicate: 0 };
    const seen = new Set<string>();
    for (const s of chosen) {
      const why = exclusionOf(s, suppressed);
      const to = normEmail(s.email);
      if (why) ex[why]++;
      else if (!personal && seen.has(to)) ex.duplicate++;
      else { seen.add(to); out.push(s); }
    }
    return { willSend: out, excluded: ex };
  }, [chosen, suppressed, personal]);

  const sample = willSend[0];
  const vars = sample ? { parent_name: sample.parent_name ?? '', student_name: sample.full_name ?? '', branch: sample.branch_name ?? '',
    balance: formatILS(sample.balance), paid: formatILS(sample.paid), total: formatILS(sample.due), date: formatDate(new Date()) } : null;

  const insertVar = (name: string) => {
    const el = bodyRef.current, token = `{${name}}`;
    if (!el) { setBody((b) => b + token); return; }
    const [a, b] = [el.selectionStart ?? body.length, el.selectionEnd ?? body.length];
    setBody(body.slice(0, a) + token + body.slice(b));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + token.length, a + token.length); });
  };

  async function pickFile(f: File | undefined) {
    setNotice(null);
    if (!f) { setAttachment(null); return; }
    if (f.size > MAX_MB * 1024 * 1024) { setNotice({ ok: false, text: `הקובץ גדול מדי (עד ${MAX_MB}MB)` }); return; }
    setAttachment({ name: f.name, type: f.type || 'application/octet-stream', b64: await fileToBase64(f), size: f.size });
  }

  async function run(kind: 'test' | 'queue') {
    setBusy(true); setNotice(null);
    const att = attachment ? { name: attachment.name, type: attachment.type, b64: attachment.b64 } : null;
    try {
      if (kind === 'test') {
        const r = await actions.test({ to: testTo || session?.user?.email || '', studentIds: willSend.map((s) => s.id as string), subject, body, attachment: att });
        setNotice(r.ok ? { ok: true, text: `מייל בדיקה נשלח${r.sample ? ` (עם הפרטים של ${r.sample})` : ''}.` } : { ok: false, text: r.error ?? 'לא נשלח' });
      } else {
        if (!window.confirm(`לשלוח ${willSend.length} מיילים להורים?`)) return;
        const r = await actions.queue({ studentIds: chosen.map((s) => s.id as string), subject, body, attachment: att });
        if (!r.ok) { setNotice({ ok: false, text: r.error ?? 'לא נשלח' }); return; }
        setPicked(new Set()); setSubject(''); setBody(''); setAttachment(null);
        onSent();
      }
    } catch (e) { setNotice({ ok: false, text: humanError(e) }); } finally { setBusy(false); }
  }

  if (students.isError) return <ErrorState error={students.error} onRetry={() => void students.refetch()} />;
  const configured = status.data?.configured === true;
  const allFilteredPicked = filtered.length > 0 && filtered.every((s) => !s.id || picked.has(s.id) || exclusionOf(s, suppressed));

  return (
    <div className="space-y-4">
      {status.data && !configured && (
        <p className="card border-warn/40 bg-warn/10 p-3 text-sm" role="status">
          שליחת המיילים עוד לא חוברה (חשבון Resend ודומיין של החוג). אפשר לנסח ולראות למי יישלח — השליחה תיפתח אחרי החיבור.
        </p>
      )}

      <section className="card space-y-3 p-4" aria-label="נמענות">
        <h2 className="font-display text-lg">למי</h2>
        <div className="grid gap-2 sm:grid-cols-4">
          <select className="field" value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="סניף">
            <option value="">כל הסניפים</option>
            {(branches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select className="field" value={studentStatus} onChange={(e) => setStudentStatus(e.target.value)} aria-label="סטטוס">
            <option value="">כל הסטטוסים</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="field" value={debt} onChange={(e) => setDebt(e.target.value)} aria-label="יתרה">
            <option value="">כל היתרות</option>
            <option value="owing">חייבות</option>
          </select>
          <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש שם או מייל" aria-label="חיפוש נמענות" />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button type="button" className="btn-ghost" disabled={filtered.length === 0}
            onClick={() => setPicked((p) => { const n = new Set(p); for (const s of filtered) if (s.id && !exclusionOf(s, suppressed)) n.add(s.id); return n; })}>
            בחירת כל המסוננות ({filtered.length})
          </button>
          {picked.size > 0 && <button type="button" className="btn-ghost" onClick={() => setPicked(new Set())}>ניקוי הבחירה</button>}
          <span className="text-soft" data-testid="recipients-summary">
            נבחרו {chosen.length} · יישלחו {willSend.length} מיילים
            {(Object.entries(excluded) as [SkipReason, number][]).filter(([, n]) => n > 0).map(([k, n]) => ` · ${n} ${SKIP_LABEL[k]}`).join('')}
          </span>
        </div>
        {students.isLoading ? <CardSkeleton rows={4} /> : (
          <div className="max-h-80 overflow-y-auto rounded-field border border-rule">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card text-right text-soft">
                <tr>
                  <th className="px-2 py-1.5"><input type="checkbox" aria-label="כל המסוננות" checked={allFilteredPicked}
                    onChange={() => setPicked((p) => { const n = new Set(p); for (const s of filtered) if (s.id && !exclusionOf(s, suppressed)) { if (allFilteredPicked) n.delete(s.id); else n.add(s.id); } return n; })} /></th>
                  <th className="px-2 py-1.5 font-medium">תלמידה</th><th className="px-2 py-1.5 font-medium">הורה</th>
                  <th className="px-2 py-1.5 font-medium">מייל</th><th className="px-2 py-1.5 font-medium">סניף</th>
                </tr>
              </thead>
              <tbody>{filtered.map((s) => {
                const why = exclusionOf(s, suppressed);
                return (
                  <tr key={s.id} data-testid="recipient-row" data-excluded={why ?? ''} className={`border-t border-rule ${why ? 'text-soft' : ''}`}>
                    <td className="px-2 py-1.5"><input type="checkbox" aria-label={`בחירת ${s.full_name}`} disabled={Boolean(why)} checked={Boolean(s.id && picked.has(s.id))}
                      onChange={() => setPicked((p) => { const n = new Set(p); if (s.id) { if (n.has(s.id)) n.delete(s.id); else n.add(s.id); } return n; })} /></td>
                    <td className="px-2 py-1.5">{s.full_name}</td>
                    <td className="px-2 py-1.5">{s.parent_name ?? '—'}</td>
                    <td className="px-2 py-1.5" dir="ltr">{s.email ?? '—'}</td>
                    <td className="px-2 py-1.5">{s.branch_name}
                      {why && <span className="mr-1 rounded-full bg-bad/10 px-2 py-0.5 text-[11px] text-bad">{SKIP_LABEL[why]}</span>}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card space-y-3 p-4" aria-label="המייל">
        <h2 className="font-display text-lg">מה</h2>
        {(templates.data ?? []).length > 0 && (
          <select className="field" value="" aria-label="התחלה מתבנית"
            onChange={(e) => { const t = (templates.data ?? []).find((x) => x.key === e.target.value); if (t) setBody(t.body); }}>
            <option value="">התחלה מתבנית (כמו בוואטסאפ)…</option>
            {(templates.data ?? []).map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
          </select>
        )}
        <input className="field" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="נושא" aria-label="נושא" maxLength={200} />
        <div className="flex flex-wrap gap-1 text-xs">
          <span className="text-soft">הוספת משתנה:</span>
          {VAR_BUTTONS.map((v) => <button key={v} type="button" className="rounded-btn border border-rule px-2 py-0.5 hover:bg-shade" onClick={() => insertVar(v)}>{`{${v}}`}</button>)}
        </div>
        <textarea ref={bodyRef} className="field min-h-40" value={body} onChange={(e) => setBody(e.target.value)} placeholder={'שלום {שם ההורה},\n…'} aria-label="תוכן המייל" />
        <label className="block text-sm">קובץ מצורף (עד {MAX_MB}MB)
          <input type="file" className="mt-1 block text-sm" aria-label="קובץ מצורף" onChange={(e) => void pickFile(e.target.files?.[0])} />
        </label>
        {attachment && <p className="text-xs text-soft">מצורף: {attachment.name} ({(attachment.size / 1024).toFixed(0)}KB) <button type="button" className="text-bad" onClick={() => setAttachment(null)}>הסרה</button></p>}
        <p className="text-xs text-soft">{personal ? 'יש משתנים אישיים — כל תלמידה מקבלת מייל משלה.' : 'בלי משתנים אישיים — מייל אחד לכל כתובת (אחיות — מייל אחד).'}</p>

        {vars && (subject || body) && (
          <div className="rounded-field border border-rule bg-shade/40 p-3 text-sm" data-testid="email-preview">
            <p className="text-xs text-soft">תצוגה מקדימה — כך יקבל/תקבל {sample?.parent_name ?? sample?.full_name}:</p>
            <p className="mt-1 font-medium">{renderTemplate(subject, vars)}</p>
            <p className="mt-1 whitespace-pre-wrap">{renderTemplate(body, vars)}</p>
            <p className="mt-2 border-t border-rule pt-1 text-xs text-soft">בתחתית: "קיבלת את המייל כי אישרת בהרשמה הצטרפות לרשימת התפוצה" + קישור הסרה.</p>
          </div>
        )}

        {notice && <p className={`text-sm ${notice.ok ? 'text-ok' : 'text-bad'}`} role={notice.ok ? 'status' : 'alert'}>{notice.text}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <input className="field w-56" dir="ltr" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder={session?.user?.email ?? 'כתובת לבדיקה'} aria-label="כתובת לבדיקה" />
          <button type="button" className="btn-ghost" disabled={busy || !configured || !subject.trim() || !body.trim()} onClick={() => void run('test')}>מייל בדיקה</button>
          <button type="button" className="btn-primary ms-auto" disabled={busy || !configured || willSend.length === 0 || !subject.trim() || !body.trim()} onClick={() => void run('queue')}>
            {busy ? 'שולח…' : `שליחה ל-${willSend.length} הורים`}
          </button>
        </div>
      </section>
    </div>
  );
}

// ─────────── יומן ───────────
const when = (iso: string | null) => (iso ? `${formatDate(iso)} ${new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}` : '');

function Log() {
  const campaigns = useEmailCampaigns();
  const [open, setOpen] = useState<string | null>(null);
  if (campaigns.isError) return <ErrorState error={campaigns.error} onRetry={() => void campaigns.refetch()} />;
  if (campaigns.isLoading) return <CardSkeleton rows={4} />;
  const list = campaigns.data ?? [];
  if (list.length === 0) return <EmptyState title="עוד לא נשלחו מיילים" hint="כל שליחה תופיע כאן, עם מצב המסירה של כל מייל." />;
  return (
    <ul className="space-y-2" aria-label="יומן שליחות">
      {list.map((c) => {
        const skipped = Object.values((c.skipped ?? {}) as Record<string, number>).reduce((a, b) => a + Number(b), 0);
        const parts = [
          ['נמסרו', c.delivered], ['נשלחו', c.sent], ['ממתינים', c.pending], ['נכשלו', c.failed], ['חזרו', c.bounced], ['בוטלו', c.cancelled],
        ].filter(([, n]) => Number(n) > 0).map(([l, n]) => `${n} ${l}`);
        return (
          <li key={c.id} className="card p-3 text-sm" data-testid="campaign">
            <button type="button" className="flex w-full flex-wrap items-baseline justify-between gap-2 text-right" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>
              <span className="font-medium">{c.subject}{c.attachment_name ? ` 📎 ${c.attachment_name}` : ''}</span>
              <span className="text-xs text-soft">{when(c.created_at)}</span>
            </button>
            <p className="mt-1 text-soft" data-testid="campaign-counts">{c.total} מיילים · {parts.join(' · ') || '—'}{skipped ? ` · ${skipped} לא נשלחו (בלי הסכמה / בלי מייל / הוסרו)` : ''}</p>
            {open === c.id && <Messages campaignId={c.id as string} />}
          </li>
        );
      })}
    </ul>
  );
}

function Messages({ campaignId }: { campaignId: string }) {
  const msgs = useEmailMessages(campaignId);
  const [view, setView] = useState<string | null>(null);
  if (msgs.isLoading) return <CardSkeleton rows={2} />;
  return (
    <div className="mt-2 table-wrap">
      <table className="w-full min-w-[34rem] text-xs">
        <thead className="text-right text-soft"><tr><th className="py-1 font-medium">למי</th><th className="py-1 font-medium">מייל</th><th className="py-1 font-medium">מצב</th><th className="py-1 font-medium">מתי</th><th /></tr></thead>
        <tbody>{(msgs.data ?? []).map((m) => (
          <tr key={m.id} className="border-t border-rule align-top" data-testid="email-message" data-status={m.status}>
            <td className="py-1">{m.to_name ?? '—'}</td>
            <td className="py-1" dir="ltr">{m.to_email}</td>
            <td className="py-1"><span className={`rounded-full px-2 py-0.5 ${MESSAGE_STATUS[m.status]?.tone ?? ''}`}>{MESSAGE_STATUS[m.status]?.label ?? m.status}</span>
              {m.error && <span className="mr-1 text-bad">{m.error}</span>}</td>
            <td className="py-1">{when(m.delivered_at ?? m.sent_at ?? m.created_at)}</td>
            <td className="py-1"><button type="button" className="text-plum" onClick={() => setView(view === m.id ? null : m.id)}>{view === m.id ? 'סגירה' : 'מה נשלח'}</button>
              {view === m.id && <div className="mt-1 whitespace-pre-wrap rounded-field bg-shade/50 p-2 text-ink"><b>{m.subject}</b>{'\n'}{m.body}</div>}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

// ─────────── רשימת התפוצה ───────────
type Row = { full_name: string | null; parent_name: string | null; parent_phone: string | null; email: string | null; branch_name: string | null; status: string | null };
const COLS: Column<Row>[] = [
  { label: 'תלמידה', value: (r) => r.full_name },
  { label: 'הורה', value: (r) => r.parent_name },
  { label: 'טלפון', value: (r) => (r.parent_phone ? formatPhone(r.parent_phone) : null) },
  { label: 'מייל', value: (r) => r.email },
  { label: 'סניף', value: (r) => r.branch_name },
];

function ListTab() {
  const list = useMailingList();
  const [q, setQ] = useState('');
  const rows = useMemo(() => (list.data ?? []).filter((r) => !q || [r.full_name, r.email, r.parent_phone, r.branch_name].some((v) => (v ?? '').includes(q))), [list.data, q]);
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input className="field flex-1" placeholder="חיפוש לפי שם, מייל, טלפון או סניף" value={q} onChange={(e) => setQ(e.target.value)} aria-label="חיפוש" />
        <button type="button" className="btn-ghost" disabled={!rows.length} onClick={() => exportXlsx('רשימת-תפוצה', [{ name: 'רשימת תפוצה', columns: COLS as Column<unknown>[], rows }])}>אקסל</button>
        <button type="button" className="btn-ghost" disabled={!rows.length} onClick={() => exportCsv('רשימת-תפוצה', COLS, rows)}>CSV</button>
      </div>
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

