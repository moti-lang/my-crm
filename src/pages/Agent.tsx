import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  useFaq, useSaveFaq, useUnanswered, useResolveUnanswered, useConversations, useConversationMessages,
  useSetTakeover, useMayQuotePrices, useSetMayQuotePrices, simulateAnswer,
  type Faq, type Unanswered, type SimTurn,
} from '@/hooks/agent';
import { useBranches } from '@/hooks/queries';
import { formatPhone, formatDate } from '@/lib/format';
import { humanError } from '@/lib/errors';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/States';

type Tab = 'simulator' | 'conversations' | 'faq' | 'unanswered';
const TABS: { id: Tab; label: string }[] = [
  { id: 'simulator', label: 'סימולטור' },
  { id: 'conversations', label: 'שיחות' },
  { id: 'faq', label: 'מאגר שאלות' },
  { id: 'unanswered', label: 'שאלות ללא מענה' },
];

/** סוכן AI (סעיף 5.11). הבעלים בלבד — RLS על כל הטבלאות כאן הוא owner-only. */
export function Agent() {
  const [tab, setTab] = useState<Tab>('simulator');
  const unanswered = useUnanswered();
  const openCount = (unanswered.data ?? []).filter((q) => !q.resolved).length;
  const [draftFromQuestion, setDraftFromQuestion] = useState<Unanswered | null>(null);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl">סוכן הלקוחות</h1>
          <p className="text-sm text-soft">עונה להורים בוואטסאפ מתוך המאגר בלבד. מה שאין במאגר עובר אלייך.</p>
        </div>
        <PriceToggle />
      </header>

      <nav className="flex gap-1 overflow-x-auto pb-1" aria-label="חלקי המסך">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} aria-pressed={tab === t.id}
            className={`shrink-0 rounded-btn px-3 py-1.5 text-sm ${tab === t.id ? 'bg-plum text-white' : 'border border-rule text-ink hover:bg-shade'}`}>
            {t.label}{t.id === 'unanswered' && openCount > 0 ? ` (${openCount})` : ''}
          </button>
        ))}
      </nav>

      {tab === 'simulator' && <Simulator />}
      {tab === 'conversations' && <Conversations />}
      {tab === 'faq' && <FaqTab draft={draftFromQuestion} onDraftDone={() => setDraftFromQuestion(null)} />}
      {tab === 'unanswered' && <UnansweredTab onMakeFaq={(q) => { setDraftFromQuestion(q); setTab('faq'); }} />}
    </div>
  );
}

function PriceToggle() {
  const may = useMayQuotePrices();
  const set = useSetMayQuotePrices();
  const on = may.data === true;
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" checked={on} disabled={may.isLoading || set.isPending} onChange={(e) => void set.mutateAsync(e.target.checked)} />
      <span>הסוכן רשאי לנקוב במחירים</span>
      <span className={`rounded-btn px-2 py-0.5 text-xs ${on ? 'bg-warn/15 text-warn' : 'bg-shade text-soft'}`}>{on ? 'מותר' : 'מפנה להניה'}</span>
    </label>
  );
}

// ─────────── סימולטור ───────────
function Simulator() {
  const faq = useFaq();
  const branches = useBranches();
  const may = useMayQuotePrices();
  const [turns, setTurns] = useState<SimTurn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [lead, setLead] = useState<Record<string, string | null> | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [turns]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setText('');
    const history = turns.filter((x) => !x.error).map((x) => ({ role: x.role, text: x.text }));
    setTurns((prev) => [...prev, { role: 'user', text: t }]);
    try {
      const outcome = await simulateAnswer({
        text: t, history,
        faq: (faq.data ?? []).filter((f) => f.is_active).map((f) => ({ question: f.question, answer: f.answer })),
        branches: (branches.data ?? []).map((b) => b.name),
        mayQuotePrices: may.data === true, lead,
      });
      if (outcome.ok) {
        setLead(outcome.answer.kind === 'lead' ? { ...(lead ?? {}), ...(outcome.answer.lead ?? {}) } : lead);
        setTurns((prev) => [...prev, { role: 'assistant', text: outcome.answer.reply, kind: outcome.answer.kind, dryRun: outcome.dryRun, faq: outcome.answer.faq_question }]);
      } else {
        setTurns((prev) => [...prev, { role: 'assistant', text: `(${outcome.reason}) ${outcome.detail}`, error: outcome.reason, dryRun: outcome.dryRun }]);
      }
    } catch (err) {
      setTurns((prev) => [...prev, { role: 'assistant', text: humanError(err), error: 'invoke' }]);
    } finally {
      setBusy(false);
    }
  }

  const KIND: Record<string, string> = { answer: 'מהמאגר', no_answer: 'אין תשובה → הפניה', lead: 'הרשמה' };

  return (
    <section className="card flex h-[32rem] flex-col">
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {turns.length === 0 && (
          <p className="text-sm text-soft">
            כתבי כמו הורה. הסימולטור מריץ את הסוכן האמיתי מול המאגר, ולא כותב דבר —
            לא שאלות ללא מענה ולא לידים. במצב הרצה יבשה התשובות מוקלטות.
          </p>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`flex ${t.role === 'user' ? 'justify-start' : 'justify-end'}`}>
            <div className={`max-w-[80%] rounded-card px-3 py-2 text-sm ${t.role === 'user' ? 'bg-shade text-ink' : t.error ? 'bg-bad/10 text-bad' : 'bg-plum text-white'}`}>
              <p className="whitespace-pre-wrap">{t.text}</p>
              {t.role === 'assistant' && !t.error && (
                <p className="mt-1 text-[11px] opacity-70">
                  {KIND[t.kind ?? ''] ?? t.kind}{t.faq ? ` · ${t.faq}` : ''}{t.dryRun ? ' · הרצה יבשה' : ''}
                </p>
              )}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form onSubmit={send} className="flex gap-2 border-t border-rule p-3">
        <input className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder="הודעה מהורה…" aria-label="הודעה" disabled={busy} />
        <button type="submit" className="btn-primary" disabled={busy || !text.trim()}>{busy ? '…' : 'שליחה'}</button>
        {turns.length > 0 && <button type="button" className="btn-ghost" onClick={() => { setTurns([]); setLead(null); }}>ניקוי</button>}
      </form>
    </section>
  );
}

// ─────────── שיחות ───────────
function Conversations() {
  const convs = useConversations();
  const [phone, setPhone] = useState<string | null>(null);
  const messages = useConversationMessages(phone);
  const takeover = useSetTakeover();
  const current = (convs.data ?? []).find((c) => c.phone === phone) ?? null;

  if (convs.isError) return <ErrorState error={convs.error} onRetry={() => void convs.refetch()} />;
  if (convs.isLoading) return <CardSkeleton rows={4} />;
  const list = convs.data ?? [];
  if (list.length === 0) return <EmptyState title="עדיין אין שיחות" hint="שיחות נוצרות מהודעות וואטסאפ נכנסות." />;

  return (
    <div className="grid gap-3 md:grid-cols-[18rem_1fr]">
      <ul className="card max-h-[32rem] divide-y divide-rule overflow-y-auto">
        {list.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => setPhone(c.phone)} aria-pressed={phone === c.phone}
              className={`w-full px-3 py-2 text-right text-sm hover:bg-shade ${phone === c.phone ? 'bg-shade' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{c.contact_name || formatPhone(c.phone)}</span>
                {c.is_human_takeover && <span className="rounded-btn bg-warn/15 px-1.5 text-[11px] text-warn">אנושי</span>}
              </div>
              <div className="text-xs text-soft" dir="ltr">{formatPhone(c.phone)}</div>
              {c.students && <div className="text-xs text-ok">ליד: {c.students.full_name}</div>}
              {c.last_message_at && <div className="text-xs text-soft">{formatDate(c.last_message_at)}</div>}
            </button>
          </li>
        ))}
      </ul>

      <section className="card flex h-[32rem] flex-col">
        {!current ? (
          <p className="p-4 text-sm text-soft">בחרי שיחה מהרשימה.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule p-3">
              <div>
                <p className="font-medium">{current.contact_name || formatPhone(current.phone)}</p>
                <p className="text-xs text-soft" dir="ltr">{formatPhone(current.phone)}</p>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={current.is_human_takeover} disabled={takeover.isPending}
                  onChange={(e) => void takeover.mutateAsync({ phone: current.phone, takeover: e.target.checked })} />
                השתלטות אנושית
              </label>
            </div>
            {current.is_human_takeover && (
              <p className="bg-warn/10 px-3 py-1.5 text-xs text-warn">הסוכן שותק בשיחה הזו. ההודעות נרשמות, את עונה.</p>
            )}
            <div className="flex-1 space-y-2 overflow-y-auto p-3">
              {messages.isLoading ? <CardSkeleton rows={3} /> : (messages.data ?? []).map((m) => (
                <div key={m.id} className={`flex ${m.direction === 'in' ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[80%] rounded-card px-3 py-2 text-sm ${m.direction === 'in' ? 'bg-shade' : 'bg-plum text-white'}`}>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                    <p className="mt-1 text-[11px] opacity-70">
                      {new Date(m.created_at).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short' })}
                      {m.direction === 'out' && m.status === 'failed' ? ' · לא נשלח' : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// ─────────── מאגר שאלות ───────────
function FaqTab({ draft, onDraftDone }: { draft: Unanswered | null; onDraftDone: () => void }) {
  const faq = useFaq();
  const save = useSaveFaq();
  const [editing, setEditing] = useState<Partial<Faq> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (draft) setEditing({ question: draft.question, answer: '', keywords: [], is_active: true });
  }, [draft]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setError(null);
    const q = (editing.question ?? '').trim();
    const a = (editing.answer ?? '').trim();
    if (!q || !a) { setError('שאלה ותשובה הן חובה.'); return; }
    try {
      await save.mutateAsync({
        id: editing.id, question: q, answer: a, keywords: editing.keywords ?? [], is_active: editing.is_active ?? true,
        resolveUnansweredId: draft && !editing.id ? draft.id : undefined,
      });
      setEditing(null);
      if (draft) onDraftDone();
    } catch (err) {
      setError(humanError(err));
    }
  }

  if (faq.isError) return <ErrorState error={faq.error} onRetry={() => void faq.refetch()} />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-soft">{(faq.data ?? []).length} שאלות. מילות המפתח עוזרות למודל להתאים ניסוחים שונים.</p>
        {!editing && <button type="button" className="btn-primary" onClick={() => setEditing({ question: '', answer: '', keywords: [], is_active: true })}>שאלה חדשה</button>}
      </div>

      {editing && (
        <form onSubmit={onSubmit} className="card space-y-3 p-4">
          {draft && !editing.id && <p className="text-xs text-warn">תשובה לשאלה שלא נענתה — כשתישמר, השאלה תסומן כטופלה.</p>}
          <label className="block text-sm">שאלה
            <input className="field mt-1" value={editing.question ?? ''} onChange={(e) => setEditing({ ...editing, question: e.target.value })} required autoFocus />
          </label>
          <label className="block text-sm">תשובה (עד 3 משפטים, בלשון נקבה)
            <textarea className="field mt-1 min-h-[5rem]" value={editing.answer ?? ''} onChange={(e) => setEditing({ ...editing, answer: e.target.value })} required />
          </label>
          <label className="block text-sm">מילות מפתח (מופרדות בפסיק)
            <input className="field mt-1" value={(editing.keywords ?? []).join(', ')}
              onChange={(e) => setEditing({ ...editing, keywords: e.target.value.split(',').map((k) => k.trim()).filter(Boolean) })} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={editing.is_active ?? true} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} /> פעילה
          </label>
          {error && <p className="text-sm text-bad" role="alert">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={save.isPending}>{save.isPending ? 'שומרת…' : 'שמירה'}</button>
            <button type="button" className="btn-ghost" onClick={() => { setEditing(null); if (draft) onDraftDone(); }}>ביטול</button>
          </div>
        </form>
      )}

      {faq.isLoading ? <CardSkeleton rows={5} /> : (
        <ul className="card divide-y divide-rule">
          {(faq.data ?? []).map((f) => (
            <li key={f.id} className={`px-3 py-2 text-sm ${f.is_active ? '' : 'opacity-60'}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{f.question}</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-soft">{f.answer}</p>
                  {f.keywords.length > 0 && <p className="mt-1 text-xs text-soft">מילות מפתח: {f.keywords.join(' · ')}</p>}
                </div>
                <div className="shrink-0 text-left text-xs text-soft">
                  <p>{f.hits} שימושים</p>
                  {!f.is_active && <p className="text-warn">לא פעילה</p>}
                  <button type="button" className="mt-1 text-plum hover:underline" onClick={() => setEditing(f)}>עריכה</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─────────── שאלות ללא מענה ───────────
function UnansweredTab({ onMakeFaq }: { onMakeFaq: (q: Unanswered) => void }) {
  const list = useUnanswered();
  const resolve = useResolveUnanswered();
  const rows = useMemo(() => list.data ?? [], [list.data]);
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  if (list.isLoading) return <CardSkeleton rows={4} />;
  if (rows.length === 0) return <EmptyState title="אין שאלות ללא מענה" hint="כל מה שההורים שאלו — יש לו תשובה במאגר." />;
  return (
    <ul className="card divide-y divide-rule">
      {rows.map((q) => (
        <li key={q.id} className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm ${q.resolved ? 'opacity-60' : ''}`}>
          <div>
            <p className="font-medium">{q.question}</p>
            <p className="text-xs text-soft" dir="ltr">{q.phone ? formatPhone(q.phone) : '—'} · {formatDate(q.created_at)}</p>
          </div>
          <div className="flex gap-1">
            {!q.resolved && <button type="button" className="btn-primary px-3 py-1 text-xs" onClick={() => onMakeFaq(q)}>הפוך לתשובה במאגר</button>}
            <button type="button" className="btn-ghost px-3 py-1 text-xs" disabled={resolve.isPending}
              onClick={() => void resolve.mutateAsync({ id: q.id, resolved: !q.resolved })}>
              {q.resolved ? 'פתיחה מחדש' : 'סימון כטופלה'}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
