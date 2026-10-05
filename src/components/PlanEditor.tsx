import { checkPlan, METHOD_LABEL, type PlanInput, type TrackDef, type TrackMethod } from '@/lib/enrollment';
import { formatILS } from '@/lib/format';

/**
 * עורך מבנה תשלום — לסניף, או לברירת המחדל של סניף חדש: הסך, דמי רישום,
 * חודש ניסיון, החזר, ומסלולי התשלום. הסכומים בכל מסלול מחושבים לפי הכלל
 * (חלוקה שווה, הראשון סופג את ההפרש) ומוצגים כאן; המסד אוכף אותו כלל.
 */
export function PlanEditor({ plan, onChange }: { plan: PlanInput; onChange: (p: PlanInput) => void }) {
  const check = checkPlan(plan);
  const defs = plan.tracks ?? [];
  const num = (k: 'annual_total' | 'registration_fee' | 'trial_days' | 'cancel_refund', label: string) => (
    <label className="block text-sm">{label}
      <input type="number" inputMode="numeric" className="field mt-1" value={plan[k] ?? ''}
        onChange={(e) => onChange({ ...plan, [k]: e.target.value === '' ? undefined : Number(e.target.value) })} />
    </label>
  );
  const setTrack = (i: number, patch: Partial<TrackDef>) => onChange({ ...plan, tracks: defs.map((d, j) => (j === i ? { ...d, ...patch } : d)) });
  const addTrack = () => {
    let n = defs.length + 1;
    while (defs.some((d) => d.key === `t${n}`)) n++;
    onChange({ ...plan, tracks: [...defs, { key: `t${n}`, label: '', method: 'standing_order', installments: 10 }] });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {num('annual_total', 'סך שנתי לכל מסלול (₪)')}
        {num('registration_fee', 'דמי רישום (₪)')}
        {num('trial_days', 'חודש ניסיון (ימים)')}
        {num('cancel_refund', 'החזר בביטול (₪)')}
      </div>
      <label className="block text-sm">ייעוד דמי הרישום
        <input className="field mt-1" value={plan.registration_fee_purpose ?? ''} onChange={(e) => onChange({ ...plan, registration_fee_purpose: e.target.value })} />
      </label>

      <div className="space-y-2">
        <p className="text-sm font-medium">מסלולי תשלום</p>
        <p className="text-xs text-soft">הסכומים מחושבים: שכר הלימוד מחולק שווה, וכשלא יוצא עגול — התשלום הראשון סופג את ההפרש. מסלולי הוראת קבע מוסתרים מההורים עד שהוראת הקבע תופעל.</p>
        {defs.map((d, i) => {
          const t = check.tracks[i];
          return (
            <div key={d.key} className="grid items-end gap-2 rounded-field border border-rule p-2 sm:grid-cols-[1fr_12rem_7rem_auto]">
              <label className="block text-sm">שם המסלול (כפי שההורה רואה)
                <input className="field mt-1" value={d.label} onChange={(e) => setTrack(i, { label: e.target.value })} />
              </label>
              <label className="block text-sm">סוג
                <select className="field mt-1" value={d.method} onChange={(e) => setTrack(i, { method: e.target.value as TrackMethod, installments: e.target.value === 'standing_order' ? (d.installments > 1 ? d.installments : 10) : 1 })}>
                  {(Object.keys(METHOD_LABEL) as TrackMethod[]).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
                </select>
              </label>
              <label className="block text-sm">תשלומים
                <input type="number" min={1} max={36} className="field mt-1" disabled={d.method !== 'standing_order'} value={d.installments}
                  onChange={(e) => setTrack(i, { installments: Number(e.target.value) })} />
              </label>
              <button type="button" className="btn-ghost px-3 py-1 text-xs text-bad" onClick={() => onChange({ ...plan, tracks: defs.filter((_, j) => j !== i) })}>הסרה</button>
              {t && (
                <p className="text-xs text-soft sm:col-span-4">
                  {t.method === 'cash' ? `${formatILS(t.total)} במזומן — בלי קישור תשלום`
                    : t.method === 'card_once' ? `קישור על ${formatILS(t.total)}`
                    : `חיוב ראשון ${formatILS(t.first_charge)} (דמי רישום + ${formatILS(t.first_installment)}), ואז ${t.installments - 1} × ${formatILS(t.installment_amount)}`}
                </p>
              )}
            </div>
          );
        })}
        <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={addTrack}>הוספת מסלול</button>
      </div>
      <p className={`text-sm ${check.ok ? 'text-ok' : 'text-bad'}`} role="status">{check.message}</p>
    </div>
  );
}

export function planOk(plan: PlanInput): boolean { return checkPlan(plan).ok; }
