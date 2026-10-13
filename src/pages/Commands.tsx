import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useAuthorizedNumbers, useSaveAuthorizedNumber, useCommands, useCancelCommand, sendTestCommand,
  SCOPE_LABEL, SCOPE_HINT, type AuthorizedNumber, type CommandRow, type Scope, type TestChatResult,
} from '@/hooks/commands';
import { useBranches } from '@/hooks/queries';
import { formatPhone, formatDate } from '@/lib/format';
import { humanError } from '@/lib/errors';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/States';

type Tab = 'numbers' | 'log' | 'chat';
const TABS: { id: Tab; label: string }[] = [
  { id: 'numbers', label: 'מספרים מורשים' },
  { id: 'log', label: 'יומן פקודות' },
  { id: 'chat', label: "צ'אט בדיקה" },
];

const INTENT_LABEL: Record<string, string> = {
  expense: 'הוצאה', income: 'הכנסה', payment: 'תשלום', new_student: 'תלמידה חדשה',
  update_student: 'עדכון תלמידה', reminder: 'תזכורת', attendance: 'נוכחות', query: 'שאלה', unknown: 'לא זוהה',
};
const DAY = 24 * 60 * 60 * 1000;

/** פקודות וואטסאפ (סעיף 4.3). המנוע: _shared/router.ts + 0012; המסך הזה מנהל ומציג אותו. */
export function Commands() {
  const numbers = useAuthorizedNumbers();
  const [tab, setTab] = useState<Tab>('numbers');
  const active = (numbers.data ?? []).filter((n) => n.is_active).length;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl">פקודות וואטסאפ</h1>
        <p className="text-sm text-soft">
          ממספר מורשה אפשר לכתוב לבוט פקודה ("שילמתי 860 תלבושות בביתר"). הבוט מציג מה הבין ומבקש אישור,
          ורק אחרי "כן" זה נרשם. מכל מספר אחר ההודעות מגיעות לסוכן הלקוחות.
        </p>
      </header>

      <nav className="flex gap-1 overflow-x-auto pb-1" aria-label="חלקי המסך">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} aria-pressed={tab === t.id}
            className={`shrink-0 rounded-btn px-3 py-1.5 text-sm ${tab === t.id ? 'bg-plum text-white' : 'border border-rule text-ink hover:bg-shade'}`}>
            {t.label}{t.id === 'numbers' && numbers.data ? ` (${active})` : ''}
          </button>
        ))}
      </nav>

      {tab === 'numbers' && <NumbersTab />}
      {tab === 'log' && <LogTab />}
      {tab === 'chat' && <ChatTab onGoToNumbers={() => setTab('numbers')} />}
    </div>
  );
}

// ─────────── מספרים מורשים ───────────
function NumbersTab() {
  const numbers = useAuthorizedNumbers();
  const branches = useBranches();
  const save = useSaveAuthorizedNumber();
  const [label, setLabel] = useState('');
  const [phone, setPhone] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [branchId, setBranchId] = useState('');
  const [canDelete, setCanDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const activeBranches = (branches.data ?? []).filter((b) => b.is_active);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!label.trim()) return setError('חסר שם');
    if (phone.replace(/\D/g, '').length < 9) return setError('מספר הטלפון לא תקין');
    if (scope === 'branch' && !branchId) return setError('במספר של סניף צריך לבחור סניף');
    try {
      await save.mutateAsync({ label: label.trim(), phone, scope, branch_id: scope === 'branch' ? branchId : null, can_delete: canDelete });
      setLabel(''); setPhone(''); setScope('all'); setBranchId(''); setCanDelete(false);
    } catch (err) { setError(humanError(err)); }
  }

  async function update(n: AuthorizedNumber, patch: { scope?: Scope; branch_id?: string | null; can_delete?: boolean; is_active?: boolean }) {
    setRowError(null);
    // מעבר לרמת "סניף" בלי סניף: לוקחים את הראשון — אחרת המסד דוחה.
    if (patch.scope === 'branch' && !n.branch_id) patch.branch_id = activeBranches[0]?.id ?? null;
    try { await save.mutateAsync({ id: n.id, ...patch }); } catch (err) { setRowError(`${n.label}: ${humanError(err)}`); }
  }

  if (numbers.isError) return <ErrorState error={numbers.error} onRetry={() => void numbers.refetch()} />;
  if (numbers.isLoading) return <CardSkeleton rows={3} />;
  const list = numbers.data ?? [];

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="card space-y-3 p-4" aria-label="הוספת מספר מורשה">
        <h2 className="font-display text-lg">הוספת מספר</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">שם
            <input className="field mt-1" aria-label="שם" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="למשל: הניה (אישי)" />
          </label>
          <label className="block text-sm">טלפון (וואטסאפ)
            <input className="field mt-1" aria-label="טלפון" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="050-0000000" inputMode="tel" dir="ltr" />
          </label>
          <label className="block text-sm">רמת הרשאה
            <select className="field mt-1" aria-label="רמת הרשאה" value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
              {(Object.keys(SCOPE_LABEL) as Scope[]).map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]} — {SCOPE_HINT[s]}</option>)}
            </select>
          </label>
          {scope === 'branch' && (
            <label className="block text-sm">סניף
              <select className="field mt-1" aria-label="סניף" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">בחרי סניף…</option>
                {activeBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={canDelete} onChange={(e) => setCanDelete(e.target.checked)} />
          רשאי למחוק (למשל "תמחקי את…")
        </label>
        {error && <p className="text-sm text-bad" role="alert">{error}</p>}
        <button type="submit" className="btn-primary" disabled={save.isPending}>{save.isPending ? 'שומר…' : 'הוספה'}</button>
      </form>

      {rowError && <p className="text-sm text-bad" role="alert">{rowError}</p>}
      {list.length === 0 ? (
        <EmptyState title="עדיין אין מספרים מורשים" hint="בלי מספר מורשה אף אחד לא יכול לשלוח פקודות לבוט. כל ההודעות מגיעות לסוכן הלקוחות." />
      ) : (
        <ul className="space-y-2" aria-label="מספרים מורשים">
          {list.map((n) => (
            <li key={n.id} className={`card space-y-2 p-3 ${n.is_active ? '' : 'opacity-60'}`} data-testid="authorized-number">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p><span className="font-medium">{n.label}</span> <span className="text-sm text-soft" dir="ltr">{formatPhone(n.phone)}</span></p>
                <span className={`rounded-btn px-2 py-0.5 text-xs ${n.is_active ? 'bg-ok/15 text-ok' : 'bg-shade text-soft'}`}>{n.is_active ? 'פעיל' : 'מושבת'}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <select className="field w-auto" value={n.scope} aria-label={`רמת הרשאה — ${n.label}`} disabled={save.isPending}
                  onChange={(e) => void update(n, { scope: e.target.value as Scope })}>
                  {(Object.keys(SCOPE_LABEL) as Scope[]).map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
                </select>
                {n.scope === 'branch' && (
                  <select className="field w-auto" value={n.branch_id ?? ''} aria-label={`סניף — ${n.label}`} disabled={save.isPending}
                    onChange={(e) => void update(n, { branch_id: e.target.value })}>
                    {activeBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                )}
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={n.can_delete} disabled={save.isPending} onChange={(e) => void update(n, { can_delete: e.target.checked })} />
                  רשאי למחוק
                </label>
                <button type="button" className="btn-ghost ms-auto" disabled={save.isPending}
                  onClick={() => {
                    if (n.is_active && !window.confirm(`להשבית את ${n.label}? מהמספר הזה לא יתקבלו עוד פקודות.`)) return;
                    void update(n, { is_active: !n.is_active });
                  }}>
                  {n.is_active ? 'השבתה' : 'הפעלה'}
                </button>
              </div>
              <p className="text-xs text-soft">{SCOPE_HINT[n.scope as Scope] ?? n.scope}{n.scope === 'branch' && n.branches ? ` · ${n.branches.name}` : ''}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─────────── יומן פקודות ───────────
type Tone = 'ok' | 'bad' | 'warn' | 'muted';
function describe(c: CommandRow, now: number): { status: string; tone: Tone; what: string } {
  const parsed = (c.parsed ?? {}) as { human_summary?: string };
  const action = [INTENT_LABEL[c.intent ?? ''] ?? c.intent, parsed.human_summary].filter(Boolean).join(' · ');
  switch (c.status) {
    case 'rejected': return { status: 'נדחה', tone: 'bad', what: c.error ?? 'הניסיון נדחה' };
    case 'failed': return { status: 'נכשל', tone: 'bad', what: `לא בוצע: ${c.error ?? ''}`.trim() };
    case 'applied': return { status: 'בוצע', tone: 'ok', what: action };
    case 'cancelled': return c.result_id
      ? { status: 'בוטל', tone: 'muted', what: `${action} — בוצע ובוטל` }
      : { status: 'לא אושר', tone: 'muted', what: `${action || 'פקודה'} — בוטלה לפני אישור, לא נשמר כלום` };
    default: return c.expires_at && new Date(c.expires_at).getTime() < now
      ? { status: 'פג תוקף', tone: 'muted', what: `${action} — לא אושרה בזמן, לא נשמר כלום` }
      : { status: 'ממתינה לאישור', tone: 'warn', what: action };
  }
}
const TONE: Record<Tone, string> = { ok: 'bg-ok/15 text-ok', bad: 'bg-bad/15 text-bad', warn: 'bg-warn/15 text-warn', muted: 'bg-shade text-soft' };
const time = (iso: string) => `${formatDate(iso)} ${new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`;

function LogTab() {
  const commands = useCommands();
  const numbers = useAuthorizedNumbers();
  const cancel = useCancelCommand();
  const [error, setError] = useState<string | null>(null);
  const byPhone = useMemo(() => new Map((numbers.data ?? []).map((n) => [n.phone, n.label])), [numbers.data]);
  const now = Date.now();

  if (commands.isError) return <ErrorState error={commands.error} onRetry={() => void commands.refetch()} />;
  if (commands.isLoading) return <CardSkeleton rows={4} />;
  const list = commands.data ?? [];
  if (list.length === 0) return <EmptyState title="היומן ריק" hint="כל פקודה שתגיע מוואטסאפ (או מצ'אט הבדיקה) תופיע כאן — גם ניסיונות שנדחו." />;

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-bad" role="alert">{error}</p>}
      <ul className="space-y-2" aria-label="יומן פקודות">
        {list.map((c) => {
          const d = describe(c, now);
          const who = byPhone.get(c.phone);
          const undoable = c.status === 'applied' && now - new Date(c.created_at).getTime() < DAY;
          return (
            <li key={c.id} data-testid="command-row" data-status={c.status}
              className={`card space-y-1 p-3 text-sm ${d.tone === 'bad' && c.status === 'rejected' ? 'border-bad/50 bg-bad/5' : ''}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p>
                  <span className={`font-medium ${who ? '' : 'text-bad'}`}>{who ?? formatPhone(c.phone)}</span>
                  {!who && <span className="text-bad"> · לא מורשה</span>}
                  {c.channel === 'test' && <span className="ms-1 rounded-btn bg-shade px-1.5 py-0.5 text-xs text-soft">צ'אט בדיקה</span>}
                </p>
                <span className="text-xs text-soft">{time(c.created_at)}</span>
              </div>
              <p className="text-ink">"{c.raw_text}"</p>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-btn px-2 py-0.5 text-xs ${TONE[d.tone]}`}>{d.status}</span>
                <span className={d.tone === 'bad' ? 'text-bad' : 'text-soft'}>{d.what}</span>
                {undoable && (
                  <button type="button" className="btn-ghost ms-auto text-bad" disabled={cancel.isPending}
                    onClick={async () => {
                      if (!window.confirm(`לבטל את הפעולה "${d.what}"? מה שנרשם יוסר מהמערכת.`)) return;
                      setError(null);
                      try { await cancel.mutateAsync(c.id); } catch (err) { setError(humanError(err)); }
                    }}>
                    ביטול
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─────────── צ'אט בדיקה ───────────
type Turn = { role: 'user'; text: string } | { role: 'bot'; out: TestChatResult };

const ROUTE_LABEL: Record<string, string> = {
  command: 'פקודה', command_parse_failed: 'לא זוהתה פקודה', command_timeout: 'המודל לא הספיק',
  confirmed: 'אושר', declined: 'בוטל', undo: 'ביטול אחרון', execute_failed: 'לא בוצע',
};

function silentReason(out: Extract<TestChatResult, { ok: true }>): string {
  if (out.route === 'command_parse_failed') return 'לא זוהתה פקודה. בוואטסאפ לא נשלחת תשובה על הודעה כזו.';
  if (out.parse?.ok && out.parse.intent === 'query') return 'זוהתה שאלה. עדיין אין מענה לשאלות ממספר מורשה, ובוואטסאפ לא נשלחת תשובה.';
  return 'בוואטסאפ לא נשלחת תשובה.';
}

function ChatTab({ onGoToNumbers }: { onGoToNumbers: () => void }) {
  const numbers = useAuthorizedNumbers();
  const qc = useQueryClient();
  const activeNumbers = (numbers.data ?? []).filter((n) => n.is_active);
  const [phone, setPhone] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [turns]);
  useEffect(() => { if (!phone && activeNumbers[0]) setPhone(activeNumbers[0].phone); }, [phone, activeNumbers]);

  async function send(raw: string) {
    const t = raw.trim();
    if (!t || busy || !phone) return;
    setBusy(true);
    setText('');
    setTurns((prev) => [...prev, { role: 'user', text: t }]);
    try {
      const out = await sendTestCommand(phone, t);
      setTurns((prev) => [...prev, { role: 'bot', out }]);
    } catch (err) {
      setTurns((prev) => [...prev, { role: 'bot', out: { ok: false, error: humanError(err) } }]);
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: ['commands'] });
    }
  }

  if (numbers.isLoading) return <CardSkeleton rows={3} />;
  if (activeNumbers.length === 0) {
    return <EmptyState title="אין מספר מורשה פעיל" hint="הצ'אט שולח פקודות בשם מספר מורשה, עם ההרשאות שלו."
      action={<button type="button" className="btn-primary" onClick={onGoToNumbers}>הוספת מספר</button>} />;
  }

  const last = turns[turns.length - 1];
  const lastOut = last?.role === 'bot' && last.out.ok ? last.out : null;
  const quick = lastOut?.commandId ? ['כן', 'לא'] : lastOut?.route === 'confirmed' && lastOut.result?.ok ? ['בטל'] : [];

  return (
    <section className="card flex h-[34rem] flex-col">
      <div className="flex-1 space-y-2 overflow-y-auto p-4" aria-live="polite">
        {turns.length === 0 && (
          <p className="text-sm text-soft">
            כתבי פקודה כמו בוואטסאפ. הצ'אט מריץ את המנוע האמיתי: אותו פענוח, אותן הרשאות של המספר שנבחר,
            ואותו שלב אישור. <b>מה שמאשרים כאן ב"כן" נרשם במערכת באמת</b> (מסומן ביומן "צ'אט בדיקה", ואפשר לבטל משם).
            שום הודעת וואטסאפ לא נשלחת.
          </p>
        )}
        {turns.map((t, i) => t.role === 'user' ? (
          <div key={i} className="flex justify-start">
            <p className="max-w-[80%] whitespace-pre-wrap rounded-card bg-shade px-3 py-2 text-sm text-ink">{t.text}</p>
          </div>
        ) : (
          <div key={i} className="flex justify-end" data-testid="bot-turn">
            <BotTurn out={t.out} />
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {quick.length > 0 && (
        <div className="flex gap-2 border-t border-rule px-3 pt-2">
          {quick.map((q) => <button key={q} type="button" className="btn-ghost" disabled={busy} onClick={() => void send(q)}>{q}</button>)}
        </div>
      )}
      <form onSubmit={(e) => { e.preventDefault(); void send(text); }} className="flex flex-wrap gap-2 border-t border-rule p-3">
        <select className="field w-auto" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="שולחת בשם">
          {activeNumbers.map((n) => <option key={n.id} value={n.phone}>{n.label} · {SCOPE_LABEL[n.scope as Scope] ?? n.scope}</option>)}
        </select>
        <input className="field flex-1" value={text} onChange={(e) => setText(e.target.value)} placeholder="למשל: שילמתי 860 תלבושות בביתר" aria-label="פקודה" disabled={busy} />
        <button type="submit" className="btn-primary" disabled={busy || !text.trim()}>{busy ? '…' : 'שליחה'}</button>
        {turns.length > 0 && <button type="button" className="btn-ghost" onClick={() => setTurns([])}>ניקוי</button>}
      </form>
    </section>
  );
}

function BotTurn({ out }: { out: TestChatResult }) {
  if (!out.ok) return <p className="max-w-[80%] rounded-card bg-bad/10 px-3 py-2 text-sm text-bad" role="alert">{out.error}</p>;
  const p = out.parse;
  const denied = out.authorized?.allowed === false;
  const failed = out.route === 'execute_failed' || denied;
  return (
    <div className={`max-w-[80%] rounded-card px-3 py-2 text-sm ${failed ? 'bg-bad/10 text-bad' : out.reply ? 'bg-plum text-white' : 'bg-shade text-soft'}`}>
      <p className="whitespace-pre-wrap">{out.reply ?? silentReason(out)}</p>
      <p className="mt-1 text-[11px] opacity-75">
        {denied ? 'נדחה בהרשאות' : ROUTE_LABEL[out.route] ?? out.route}
        {p?.ok && ` · ${INTENT_LABEL[p.intent] ?? p.intent} · ביטחון ${Math.round(p.confidence * 100)}%`}
        {p && !p.ok && ` · ${p.reason}`}
        {p?.dryRun ? ' · הרצה יבשה' : ''}
      </p>
      {p?.ok && Object.keys(p.fields).length > 0 && (
        <p className="mt-0.5 text-[11px] opacity-75">
          {Object.entries(p.fields).filter(([, v]) => v !== null && v !== '').map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}
        </p>
      )}
    </div>
  );
}
