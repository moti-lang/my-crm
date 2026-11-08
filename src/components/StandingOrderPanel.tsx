import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import {
  EVENT_LABEL, STANDING_LABEL, STANDING_TONE, RescheduleChanged, RetryChanged, eventChange, useCancelStanding, useReschedulePreview, useRescheduleStanding,
  useRetryPreview, useRetryStanding, useStandingEvents, type StandingOrder,
} from '@/hooks/standing';
import { formatDate, formatDateTime, formatILS } from '@/lib/format';
import { humanError } from '@/lib/errors';

/** הוראת קבע של תלמידה: חיוב X מתוך N, הבא מתי, שינוי יום חיוב, ניסיון חיוב חוזר ועצירה לבעלים, והיומן שלה. */
export function StandingOrderPanel({ order }: { order: StandingOrder }) {
  const { profile } = useAuth();
  const cancel = useCancelStanding();
  const events = useStandingEvents(order.id);
  const [rescheduling, setRescheduling] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [retried, setRetried] = useState<string | null>(null);
  const live = order.status && !['cancelled', 'completed'].includes(order.status);
  const owner = profile?.role === 'owner';
  return (
    <div className="space-y-1 text-sm">
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs ${STANDING_TONE[order.status ?? ''] ?? ''}`}>{STANDING_LABEL[order.status ?? ''] ?? order.status}</span>
        <span className="tabular-nums">חיוב {order.charged_total} מתוך {order.installments_total}</span>
      </div>
      <p className="text-soft">
        {formatILS(order.amount)} בחודש · {order.next_billing ? `הבא: ${formatDate(order.next_billing)}` : 'אין חיוב מתוכנן'}
        {live && order.billing_day ? ` · כל ${order.billing_day} לחודש` : ''}
      </p>
      {order.last_error && <p className="text-xs text-bad">{order.last_error}</p>}
      {saved && <p className="text-xs text-ok" role="status">✓ נשמר ב-SUMIT: {saved}</p>}
      {cancel.error != null && <p className="text-xs text-bad" role="alert">{humanError(cancel.error)}</p>}
      {owner && order.status === 'active' && order.id && (rescheduling
        ? <RescheduleForm order={order} onDone={(sentence) => { setSaved(sentence); setRescheduling(false); }} onCancel={() => setRescheduling(false)} />
        : <button type="button" className="btn-ghost mt-1 px-3 py-1 text-xs" onClick={() => { setSaved(null); setRescheduling(true); }}>שינוי יום חיוב</button>)}
      {retried && <p className="text-xs text-ok" role="status">{retried}</p>}
      {owner && order.status === 'failed' && order.id && (retrying
        ? <RetryForm order={order} onDone={(msg) => { setRetried(msg); setRetrying(false); }} onCancel={() => setRetrying(false)} />
        : <button type="button" className="btn-ghost mt-1 px-3 py-1 text-xs" onClick={() => { setRetried(null); setRetrying(true); }}>ניסיון חיוב חוזר</button>)}
      {owner && live && order.id && !rescheduling && !retrying && (
        <button type="button" className="btn-ghost mt-1 px-3 py-1 text-xs text-bad" disabled={cancel.isPending}
          onClick={() => {
            if (!window.confirm(`לעצור את הוראת הקבע של ${order.full_name}? החיובים הבאים יבוטלו ב-SUMIT.`)) return;
            cancel.mutate(order.id as string);
          }}>
          {cancel.isPending ? 'עוצרת ב-SUMIT…' : 'עצירת הוראת קבע'}
        </button>
      )}
      {(events.data ?? []).length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-rule pt-1 text-xs text-soft" aria-label="יומן ההוראה">
          {(events.data ?? []).map((e) => (
            <li key={e.id}>{formatDateTime(e.created_at)} · {e.actor_label} ({EVENT_LABEL[e.kind ?? ''] ?? e.kind}): {eventText(e)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** שינוי תאריך / סכום: "מ-X ל-Y". חיוב חוזר וחידוש: "על מה · מה קרה". */
function eventText(e: Parameters<typeof eventChange>[0]): string {
  const [from, to] = eventChange(e, formatDate, formatILS);
  return ['retry_charge', 'retry_declined', 'renewed'].includes(e.kind ?? '') ? `${from} · ${to}` : `מ-${from} ל-${to}`;
}

const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

/**
 * "שינוי יום חיוב": בוחרים יום → המסד מחשב את התאריך הבא ומציג משפט ברור
 * ("החיוב הבא יהיה ב-20/12, ואחריו כל 20 לחודש") — ורק אז אפשר לשמור.
 */
function RescheduleForm({ order, onDone, onCancel }: { order: StandingOrder; onDone: (sentence: string) => void; onCancel: () => void }) {
  const [day, setDay] = useState<number | null>(null);
  const preview = useReschedulePreview(order.id, day);
  const save = useRescheduleStanding();
  const plan = preview.data;
  const changed = save.error instanceof RescheduleChanged;
  return (
    <div className="mt-1 space-y-2 rounded-field border border-rule p-2" data-testid="reschedule">
      <label className="flex items-center gap-2 text-xs">יום חיוב חדש:
        <select className="field w-auto py-1 text-sm" value={day ?? ''} aria-label="יום חיוב חדש"
          onChange={(e) => { save.reset(); setDay(e.target.value ? Number(e.target.value) : null); }}>
          <option value="">בחרי יום</option>
          {DAYS.map((d) => <option key={d} value={d}>{d} לחודש</option>)}
        </select>
      </label>
      {day && preview.isLoading && <p className="text-xs text-soft">מחשבת…</p>}
      {preview.error != null && <p className="text-xs text-bad" role="alert">{humanError(preview.error)}</p>}
      {plan && !plan.ok && <p className="text-xs text-bad" role="alert">{plan.error}</p>}
      {plan?.ok && (
        <div className="space-y-0.5 text-xs">
          <p className="text-soft">{plan.current}</p>
          <p className="text-soft">{plan.reason}</p>
          <p className="text-sm font-medium" data-testid="reschedule-sentence">{plan.sentence}</p>
        </div>
      )}
      {save.error != null && <p className={`text-xs ${changed ? 'text-warn' : 'text-bad'}`} role="alert">{humanError(save.error)}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn-primary px-3 py-1 text-xs"
          disabled={!plan?.ok || preview.isFetching || save.isPending}
          onClick={() => {
            if (!plan?.ok || !order.id) return;
            save.mutate({ id: order.id, day: plan.day, expected: plan.next }, { onSuccess: (p) => onDone(p.sentence) });
          }}>
          {save.isPending ? 'משנה ב-SUMIT…' : 'לשנות ב-SUMIT'}
        </button>
        <button type="button" className="btn-ghost px-3 py-1 text-xs" disabled={save.isPending} onClick={onCancel}>ביטול</button>
      </div>
    </div>
  );
}

/**
 * "ניסיון חיוב חוזר" — הוראה ש-SUMIT השביתה אחרי חיוב שנכשל. התוכנית מהמסד במילים (כמה, ומה יקרה אם
 * יעבור ואם לא), ורק אז: חיוב אחד על הכרטיס השמור, והוראה חדשה לחיובים שנותרו. אם החיוב כבר עבר
 * והחידוש נכשל — הכפתור רק מחדש, בלי חיוב נוסף.
 */
function RetryForm({ order, onDone, onCancel }: { order: StandingOrder; onDone: (msg: string) => void; onCancel: () => void }) {
  const preview = useRetryPreview(order.id, true);
  const retry = useRetryStanding();
  const plan = preview.data;
  const changed = retry.error instanceof RetryChanged;
  const label = plan?.ok ? (plan.stage === 'charge' ? `לחייב עכשיו ${formatILS(plan.amount)}` : 'לחדש את ההוראה ב-SUMIT') : '';
  return (
    <div className="mt-1 space-y-2 rounded-field border border-rule p-2" data-testid="retry">
      {preview.isLoading && <p className="text-xs text-soft">בודקת…</p>}
      {preview.error != null && <p className="text-xs text-bad" role="alert">{humanError(preview.error)}</p>}
      {plan && !plan.ok && <p className="text-xs text-bad" role="alert">{plan.error}</p>}
      {plan?.ok && (
        <ul className="space-y-0.5 text-xs" data-testid="retry-plan">
          {plan.lines.map((l) => <li key={l}>{l}</li>)}
        </ul>
      )}
      {retry.error != null && <p className={`text-xs ${changed ? 'text-warn' : 'text-bad'}`} role="alert">{humanError(retry.error)}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn-primary px-3 py-1 text-xs" disabled={!plan?.ok || preview.isFetching || retry.isPending}
          onClick={() => {
            if (!plan?.ok || !order.id) return;
            if (plan.stage === 'charge' && !window.confirm(`לחייב עכשיו ${formatILS(plan.amount)} בכרטיס השמור של ההורה של ${order.full_name}?`)) return;
            retry.mutate({ id: order.id, stage: plan.stage, next: plan.next }, {
              onSuccess: (r) => onDone([
                r.charged > 0 ? `✓ החיוב עבר (${formatILS(r.charged)}).` : '',
                r.renewed ? `ההוראה חודשה ב-SUMIT: ${r.remaining} חיובים מ-${formatDate(r.next)}.` : r.completed ? 'זה היה החיוב האחרון — ההוראה הסתיימה.' : '',
              ].filter(Boolean).join(' ')),
            });
          }}>
          {retry.isPending ? 'מחייבת ב-SUMIT…' : label || 'ניסיון חיוב חוזר'}
        </button>
        <button type="button" className="btn-ghost px-3 py-1 text-xs" disabled={retry.isPending} onClick={onCancel}>ביטול</button>
      </div>
    </div>
  );
}
