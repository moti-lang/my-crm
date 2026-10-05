import { checkPlan, type PlanInput } from '@/lib/enrollment';

/**
 * עורך מבנה תשלום — לסניף, או לברירת המחדל של סניף חדש. הבדיקה כאן היא
 * תצוגה בלבד; המסד אוכף את אותם כללים (f_plan_check) ומסרב לשמור מבנה שגוי.
 * החיוב הראשון מחושב: דמי רישום + תשלום אחד.
 */
export function PlanEditor({ plan, onChange }: { plan: PlanInput; onChange: (p: PlanInput) => void }) {
  const check = checkPlan(plan);
  const set = (k: keyof PlanInput, v: number) => {
    const next = { ...plan, [k]: v };
    onChange({ ...next, first_charge: checkPlan(next).first_charge });
  };
  const num = (k: keyof PlanInput, label: string) => (
    <label className="block text-sm">{label}
      <input type="number" inputMode="numeric" className="field mt-1" value={(plan[k] as number | undefined) ?? ''}
        onChange={(e) => set(k, e.target.value === '' ? Number.NaN : Number(e.target.value))} />
    </label>
  );
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {num('annual_total', 'שכר לימוד שנתי כולל (₪)')}
        {num('registration_fee', 'דמי רישום (₪)')}
        {num('installments', 'מספר תשלומים')}
        {num('installment_amount', 'סכום לכל תשלום (₪)')}
        {num('trial_days', 'חודש ניסיון (ימים)')}
        {num('cancel_refund', 'החזר בביטול (₪)')}
      </div>
      <label className="block text-sm">ייעוד דמי הרישום
        <input className="field mt-1" value={plan.registration_fee_purpose ?? ''} onChange={(e) => onChange({ ...plan, registration_fee_purpose: e.target.value })} />
      </label>
      <p className={`text-sm ${check.ok ? 'text-ok' : 'text-bad'}`} role="status">{check.message}</p>
    </div>
  );
}

export function planOk(plan: PlanInput): boolean { return checkPlan(plan).ok; }
