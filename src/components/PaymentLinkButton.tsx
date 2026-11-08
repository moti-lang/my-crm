import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { useCreatePaymentLink, type PaymentLinkResult } from '@/hooks/finance';
import { humanError } from '@/lib/errors';
import { formatILS } from '@/lib/format';
import { linkAmountError } from '@/lib/enrollment';
import { LinkResult } from '@/components/LinkResult';

/**
 * "קישור תשלום" — הבעלים ומנהלת הסניף. הסכום: כל החוב, או פחות (למשל 100 ₪ בכרטיס והשאר במזומן).
 * הסכום והתלמידה ננעלים במסד (rpc_create_payment_link: לפחות 1 ₪, לא יותר מהחוב). ההודעה נכנסת
 * לתור הוואטסאפ; המסך אומר אם היא באמת יוצאת, ומאפשר להעתיק את הקישור.
 */
export function PaymentLinkButton({ studentId, balance, hasPhone, compact = false }:
  { studentId: string; balance: number; hasPhone: boolean; compact?: boolean }) {
  const { profile } = useAuth();
  const create = useCreatePaymentLink();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [result, setResult] = useState<{ url: string; amount: number; whatsapp: PaymentLinkResult['whatsapp'] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!profile || !['owner', 'branch_manager'].includes(profile.role) || balance <= 0) return null;
  const invalid = linkAmountError(amount, balance);

  async function send() {
    if (invalid) return;
    setError(null);
    const n = Number(amount);
    const part = n < balance ? ` (מתוך חוב של ${formatILS(balance)})` : '';
    if (!window.confirm(`ליצור להורה קישור לתשלום ${formatILS(n)}${part}? הקישור תקף 7 ימים.`)) return;
    try {
      const r = await create.mutateAsync({ studentId, amount: n });
      setResult({ url: r.url, amount: Number(r.amount), whatsapp: r.whatsapp });
      setOpen(false);
    } catch (e) { setError(humanError(e)); }
  }

  return (
    <span className={compact ? 'inline-flex flex-col items-start gap-1' : 'mt-2 block'}>
      {open ? (
        <span className="flex flex-wrap items-center gap-2" data-testid="payment-link-form">
          <label className="flex items-center gap-1 text-xs">סכום:
            <input className="field w-24 py-1 text-sm" type="number" inputMode="decimal" min={1} max={balance} step="any" dir="ltr"
              aria-label="סכום לקישור" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <button type="button" className="btn-primary px-3 py-1 text-xs" disabled={Boolean(invalid) || create.isPending || !hasPhone} onClick={() => void send()}>
            {create.isPending ? 'יוצרת…' : 'יצירת קישור'}
          </button>
          <button type="button" className="btn-ghost px-3 py-1 text-xs" disabled={create.isPending} onClick={() => setOpen(false)}>ביטול</button>
          {amount && invalid ? <span className="w-full text-xs text-bad">{invalid}</span>
            : Number(amount) < balance ? <span className="w-full text-xs text-soft">חלק מהחוב ({formatILS(balance)}). את השאר רושמים כשמתקבל.</span> : null}
        </span>
      ) : (
        <button type="button" className={compact ? 'btn-ghost px-2 py-1 text-xs' : 'btn-ghost w-full'} disabled={!hasPhone}
          title={hasPhone ? 'דף תשלום בכרטיס דרך SUMIT' : 'אין טלפון של הורה'}
          onClick={() => { setError(null); setResult(null); setAmount(String(balance)); setOpen(true); }}>
          💳 קישור תשלום
        </button>
      )}
      {result && <LinkResult url={result.url} amount={result.amount} whatsapp={result.whatsapp} />}
      {error && <span className="text-xs text-bad" role="alert">{error}</span>}
    </span>
  );
}
