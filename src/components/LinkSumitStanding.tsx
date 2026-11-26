import { useState } from 'react';
import { useSumitLink, useSumitLinkList, type SumitLinkItem } from '@/hooks/standing';
import { formatDate, formatILS } from '@/lib/format';
import { humanError } from '@/lib/errors';

/**
 * ★ "חיבור הוראת קבע מ-SUMIT" (הבעלים): להורה שנפתחה לו הוראה ידנית ב-SUMIT (לא דרך קישור ההרשמה).
 *   מספר הלקוח ב-SUMIT → ההוראות שלו → בוחרים, ומזינים כמה תשלומים יש בה בסך הכל. כמה נותרו — לפי SUMIT.
 *   מכאן המערכת רושמת כל חיוב שעובר ומתריעה כשחיוב נכשל. בלי מספר כרטיס — רק המזהים של SUMIT.
 */
export function LinkSumitStanding({ studentId, name }: { studentId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [customer, setCustomer] = useState('');
  const [pick, setPick] = useState<SumitLinkItem | null>(null);
  const [total, setTotal] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const list = useSumitLinkList();
  const link = useSumitLink();
  const customerId = Number(customer);
  const n = Number(total);
  const validTotal = Number.isInteger(n) && n >= 2 && n <= 36 && pick?.remaining != null && n >= pick.remaining;

  if (done) return <p className="text-xs text-ok" role="status">{done}</p>;
  if (!open) {
    return (
      <button type="button" className="btn-ghost w-full text-xs" onClick={() => setOpen(true)}>
        חיבור הוראת קבע שנפתחה ב-SUMIT
      </button>
    );
  }
  return (
    <div className="space-y-2 rounded-field border border-rule p-3 text-sm" data-testid="sumit-link">
      <p className="text-xs text-soft">להוראה שנפתחה ידנית ב-SUMIT: אחרי החיבור המערכת רושמת כל חיוב שעובר, ומתריעה כשחיוב נכשל.</p>
      <div className="flex items-end gap-2">
        <label className="block flex-1 text-xs">מספר הלקוח ב-SUMIT
          <input className="field mt-0.5" inputMode="numeric" dir="ltr" value={customer} aria-label="מספר הלקוח ב-SUMIT"
            onChange={(e) => { setCustomer(e.target.value.replace(/\D/g, '')); setPick(null); list.reset(); link.reset(); }} />
        </label>
        <button type="button" className="btn-ghost px-3 py-2 text-xs" disabled={!customerId || list.isPending}
          onClick={() => list.mutate({ student: studentId, customerId })}>
          {list.isPending ? 'מחפשת…' : 'חיפוש ב-SUMIT'}
        </button>
      </div>
      {list.error != null && <p className="text-xs text-bad" role="alert">{humanError(list.error)}</p>}
      {list.data && list.data.length === 0 && <p className="text-xs text-soft">ללקוח הזה אין ב-SUMIT הוראות קבע שאפשר לחבר.</p>}
      {list.data && list.data.length > 0 && (
        <ul className="space-y-1" aria-label="הוראות הקבע ב-SUMIT">
          {list.data.map((it) => (
            <li key={it.id}>
              <label className={`flex items-start gap-2 rounded-field border p-2 text-xs ${pick?.id === it.id ? 'border-plum' : 'border-rule'} ${it.linkable ? '' : 'opacity-60'}`}>
                <input type="radio" name="sumit-item" disabled={!it.linkable} checked={pick?.id === it.id}
                  onChange={() => { setPick(it); setTotal(''); link.reset(); }} aria-label={`הוראה ${it.id}`} />
                <span>
                  <b>{it.amount != null ? formatILS(it.amount) : '—'} בחודש</b> · {it.statusLabel}
                  {it.next ? ` · הבא ${formatDate(it.next)}` : ''}{it.last ? ` · אחרון ${formatDate(it.last)}` : ''}
                  {it.remaining != null ? ` · נותרו ${it.remaining}` : ''}
                  {!it.linkable && it.reason && <span className="block text-bad">{it.reason}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {pick && (
        <div className="space-y-2">
          <label className="block text-xs">כמה תשלומים יש בהוראה בסך הכל (למשל 10)
            <input className="field mt-0.5 w-24" inputMode="numeric" value={total} aria-label="מספר התשלומים בהוראה"
              onChange={(e) => { setTotal(e.target.value.replace(/\D/g, '')); link.reset(); }} />
          </label>
          {total !== '' && !validTotal && (
            <p className="text-xs text-bad" role="alert">בין 2 ל-36, ולא פחות ממה שנותר לפי SUMIT ({pick.remaining}).</p>
          )}
          {validTotal && (
            <p className="text-xs" data-testid="sumit-link-plan">
              לפי SUMIT: <b>בוצעו {n - (pick.remaining ?? 0)} מתוך {n}</b>, נותרו {pick.remaining} של {formatILS(pick.amount ?? 0)}
              {pick.next ? `, הבא ב-${formatDate(pick.next)}` : ''}.
              <span className="block text-warn">★ מעכשיו החיובים נרשמים לבד — לא לרשום אותם ידנית (יירשמו פעמיים). חיובים שכבר עברו לא נרשמים שוב.</span>
            </p>
          )}
          {link.error != null && <p className="text-xs text-bad" role="alert">{humanError(link.error)}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn-primary px-3 py-1 text-xs" disabled={!validTotal || link.isPending}
              onClick={() => {
                if (!window.confirm(`לחבר את הוראת הקבע מ-SUMIT ל${name}? מעכשיו החיובים בה נרשמים לבד.`)) return;
                link.mutate({ student: studentId, customerId, recurringId: pick.id, total: n },
                  { onSuccess: (r) => setDone(`✓ חוברה: חיוב ${r.done} מתוך ${r.total}, נותרו ${r.left}. מעכשיו כל חיוב נרשם לבד, וחיוב שנכשל יופיע ב"הוראות קבע".`) });
              }}>
              {link.isPending ? 'מחברת…' : 'חיבור'}
            </button>
            <button type="button" className="btn-ghost px-3 py-1 text-xs" disabled={link.isPending} onClick={() => setOpen(false)}>ביטול</button>
          </div>
        </div>
      )}
    </div>
  );
}
