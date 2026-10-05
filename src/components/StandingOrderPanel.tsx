import { useAuth } from '@/auth/AuthProvider';
import { STANDING_LABEL, STANDING_TONE, useCancelStanding, type StandingOrder } from '@/hooks/standing';
import { formatDate, formatILS } from '@/lib/format';
import { humanError } from '@/lib/errors';

/** הוראת קבע של תלמידה: חיוב X מתוך N, הבא מתי, ועצירה לבעלים. */
export function StandingOrderPanel({ order }: { order: StandingOrder }) {
  const { profile } = useAuth();
  const cancel = useCancelStanding();
  const live = order.status && !['cancelled', 'completed'].includes(order.status);
  return (
    <div className="space-y-1 text-sm">
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs ${STANDING_TONE[order.status ?? ''] ?? ''}`}>{STANDING_LABEL[order.status ?? ''] ?? order.status}</span>
        <span className="tabular-nums">חיוב {order.charged_total} מתוך {order.installments_total}</span>
      </div>
      <p className="text-soft">{formatILS(order.amount)} בחודש · {order.next_billing ? `הבא: ${formatDate(order.next_billing)}` : 'אין חיוב מתוכנן'}</p>
      {order.last_error && <p className="text-xs text-bad">{order.last_error}</p>}
      {cancel.error != null && <p className="text-xs text-bad" role="alert">{humanError(cancel.error)}</p>}
      {profile?.role === 'owner' && live && order.id && (
        <button type="button" className="btn-ghost mt-1 px-3 py-1 text-xs text-bad" disabled={cancel.isPending}
          onClick={() => {
            if (!window.confirm(`לעצור את הוראת הקבע של ${order.full_name}? החיובים הבאים יבוטלו ב-SUMIT.`)) return;
            cancel.mutate(order.id as string);
          }}>
          {cancel.isPending ? 'עוצרת ב-SUMIT…' : 'עצירת הוראת קבע'}
        </button>
      )}
    </div>
  );
}
