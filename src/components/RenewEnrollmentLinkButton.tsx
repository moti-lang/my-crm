import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { useRenewEnrollmentLink } from '@/hooks/finance';
import { humanError } from '@/lib/errors';
import { formatILS } from '@/lib/format';

/**
 * "קישור הרשמה חדש" — לתלמידה שממתינה לחיוב הראשון (הכרטיס לא עבר / הקישור פג). כמו בהרשמה:
 * אותו מסלול וסכום; בהוראת קבע ההורה בוחרת יום ומאשרת, וההוראה נוצרת אחרי התשלום. הקודם מתבטל.
 */
export function RenewEnrollmentLinkButton({ studentId, hasPhone, standing, compact = false }:
  { studentId: string; hasPhone: boolean; standing: boolean; compact?: boolean }) {
  const { profile } = useAuth();
  const renew = useRenewEnrollmentLink();
  const [result, setResult] = useState<{ url: string; amount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!profile || !['owner', 'branch_manager'].includes(profile.role)) return null;

  async function send() {
    setError(null);
    const what = standing ? ' בדף ההורה תבחר יום חיוב ותאשר את הוראת הקבע, וההוראה תיווצר אחרי התשלום הראשון.' : '';
    if (!window.confirm(`לשלוח להורה קישור חדש להשלמת ההרשמה בוואטסאפ?${what}\nהקישור הקודם יבוטל. הקישור החדש תקף 7 ימים.`)) return;
    try {
      const r = await renew.mutateAsync(studentId);
      setResult({ url: r.url, amount: Number(r.amount) });
    } catch (e) { setError(humanError(e)); }
  }

  return (
    <span className={compact ? 'inline-flex flex-col items-start gap-1' : 'mt-2 block'}>
      <button type="button" className={compact ? 'btn-ghost px-2 py-1 text-xs' : 'btn-ghost w-full'} disabled={renew.isPending || !hasPhone}
        title={hasPhone ? 'קישור חדש לחיוב הראשון, כמו בהרשמה' : 'אין טלפון של הורה'} onClick={() => void send()}>
        {renew.isPending ? 'שולח…' : '🔁 קישור הרשמה חדש'}
      </button>
      {result && <span className="text-xs text-ok" role="status">נשלח: {formatILS(result.amount)} · <a className="underline" href={result.url} target="_blank" rel="noreferrer">הקישור</a></span>}
      {error && <span className="text-xs text-bad" role="alert">{error}</span>}
    </span>
  );
}
