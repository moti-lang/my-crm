import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { useCreatePaymentLink } from '@/hooks/finance';
import { humanError } from '@/lib/errors';
import { formatILS } from '@/lib/format';

/**
 * "שלח קישור תשלום" — הבעלים ומנהלת הסניף. הסכום והתלמידה ננעלים במסד
 * (rpc_create_payment_link); ההודעה יוצאת בוואטסאפ דרך תור התזכורות.
 */
export function PaymentLinkButton({ studentId, balance, hasPhone, compact = false }:
  { studentId: string; balance: number; hasPhone: boolean; compact?: boolean }) {
  const { profile } = useAuth();
  const create = useCreatePaymentLink();
  const [result, setResult] = useState<{ url: string; amount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!profile || !['owner', 'branch_manager'].includes(profile.role) || balance <= 0) return null;

  async function send() {
    setError(null);
    if (!window.confirm(`לשלוח להורה קישור לתשלום ${formatILS(balance)} בוואטסאפ? הקישור תקף 7 ימים.`)) return;
    try {
      const r = await create.mutateAsync({ studentId, amount: balance });
      setResult({ url: r.url, amount: Number(r.amount) });
    } catch (e) { setError(humanError(e)); }
  }

  return (
    <span className={compact ? 'inline-flex flex-col items-start gap-1' : 'mt-2 block'}>
      <button type="button" className={compact ? 'btn-ghost px-2 py-1 text-xs' : 'btn-ghost w-full'} disabled={create.isPending || !hasPhone}
        title={hasPhone ? 'דף תשלום בכרטיס דרך SUMIT, נשלח בוואטסאפ' : 'אין טלפון של הורה'} onClick={() => void send()}>
        {create.isPending ? 'שולח…' : '💳 קישור תשלום'}
      </button>
      {result && <span className="text-xs text-ok">נשלח: {formatILS(result.amount)} · <a className="underline" href={result.url} target="_blank" rel="noreferrer">הקישור</a></span>}
      {error && <span className="text-xs text-bad" role="alert">{error}</span>}
    </span>
  );
}
