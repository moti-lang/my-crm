import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import {
  EVENT_LABEL, STANDING_LABEL, STANDING_TONE, RescheduleChanged, useCancelStanding, useReschedulePreview, useRescheduleStanding,
  useStandingEvents, type StandingOrder,
} from '@/hooks/standing';
import { formatDate, formatDateTime, formatILS } from '@/lib/format';
import { humanError } from '@/lib/errors';

/** הוראת קבע של תלמידה: חיוב X מתוך N, הבא מתי, שינוי יום חיוב ועצירה לבעלים, והיומן שלה. */
export function StandingOrderPanel({ order }: { order: StandingOrder }) {
  const { profile } = useAuth();
  const cancel = useCancelStanding();
  const events = useStandingEvents(order.id);
  const [rescheduling, setRescheduling] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
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
      {owner && live && order.id && !rescheduling && (
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
            <li key={e.id}>{formatDateTime(e.created_at)} · {e.actor_label} ({EVENT_LABEL[e.kind ?? ''] ?? e.kind}): מ-{formatDate(e.from_date)} ל-{formatDate(e.to_date)}</li>
          ))}
        </ul>
      )}
    </div>
  );
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
