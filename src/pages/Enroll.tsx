import { useMemo, useState, type FormEvent } from 'react';
import { useEnrollmentPublic, enroll, type EnrollResult } from '@/hooks/enrollment';
import { validateEnroll, describePlan, type EnrollForm } from '@/lib/enrollment';
import { formatILS } from '@/lib/format';

/**
 * /enroll — דף ההרשמה הציבורי. מחוץ ל-AuthProvider, כמו דף התשלום.
 * הכל מהמסד: שם החוג, התקנון, מבנה התשלום, הסניפים. השליחה היא RPC אחד
 * (rpc_enroll) שמאמת שדות ומגביל קצב במסד; הדף לא נוגע בטבלאות.
 * בסיום: קישור התשלום על החיוב הראשון מוצג מיד, ונשלח גם בוואטסאפ.
 */
const EMPTY: EnrollForm = { first_name: '', last_name: '', grade: '', school: '', phone: '', email: '', branch_id: '', mailing_consent: false, terms_accepted: false };

export function Enroll() {
  const info = useEnrollmentPublic();
  const [form, setForm] = useState<EnrollForm>(EMPTY);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EnrollResult | null>(null);
  const [termsOpen, setTermsOpen] = useState(false);
  const errors = useMemo(() => validateEnroll(form), [form]);
  const set = <K extends keyof EnrollForm>(k: K, v: EnrollForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length) return;
    setBusy(true);
    try { setResult(await enroll(form)); }
    catch { setResult({ ok: false, error: 'לא הצלחנו לשלוח את ההרשמה. בדקי את החיבור ונסי שוב.' }); }
    finally { setBusy(false); }
  }

  if (info.isLoading) return <main className="p-6 text-center text-sm text-soft">טוען…</main>;
  if (info.isError || !info.data) return <main className="p-6 text-center text-sm text-bad">ההרשמה אינה זמינה כרגע. נסי שוב מאוחר יותר.</main>;
  const { program_name, terms, plan, branches } = info.data;

  if (result?.ok) {
    return (
      <main className="mx-auto max-w-md space-y-4 p-5 text-ink">
        <header className="text-center"><p className="text-xs text-soft">{program_name}</p><h1 className="text-2xl">ההרשמה נקלטה 🌸</h1></header>
        <section className="card space-y-3 p-5">
          <p className="text-sm">{result.student} רשומה ל{result.branch}. כדי להשלים את ההרשמה נשאר החיוב הראשון:</p>
          <p className="text-center font-display text-3xl tabular-nums">{formatILS(result.amount)}</p>
          <p className="text-xs text-soft">{plan.registration_fee} ₪ דמי רישום + {plan.installment_amount} ₪ תשלום ראשון מתוך שכר הלימוד.</p>
          <a href={result.pay_url} className="btn-primary block w-full text-center text-base">לתשלום בכרטיס אשראי</a>
          <p className="text-center text-xs text-soft">הקישור נשלח אלייך גם בוואטסאפ, ותקף 7 ימים. ההרשמה תאושר סופית אחרי התשלום.</p>
        </section>
      </main>
    );
  }

  const Field = ({ k, label, type = 'text', dir }: { k: keyof EnrollForm; label: string; type?: string; dir?: string }) => (
    <label className="block text-sm">{label}
      <input type={type} dir={dir} className="field mt-1" value={String(form[k])} onChange={(e) => set(k, e.target.value as never)} autoComplete="off" />
      {touched && errors[k] && <span className="mt-0.5 block text-xs text-bad">{errors[k]}</span>}
    </label>
  );

  return (
    <main className="mx-auto max-w-md space-y-4 p-5 text-ink">
      <header className="text-center"><p className="text-xs text-soft">{program_name}</p><h1 className="text-2xl">הרשמה לחוג</h1></header>
      <form onSubmit={submit} className="card space-y-3 p-5" noValidate>
        <div className="grid grid-cols-2 gap-2">
          <Field k="first_name" label="שם פרטי" />
          <Field k="last_name" label="שם משפחה" />
          <Field k="grade" label="כיתה" />
          <Field k="school" label="בית ספר" />
        </div>
        <Field k="phone" label="טלפון (נייד)" type="tel" dir="ltr" />
        <Field k="email" label="מייל" type="email" dir="ltr" />
        <label className="block text-sm">סניף
          <select className="field mt-1" value={form.branch_id} onChange={(e) => set('branch_id', e.target.value)}>
            <option value="">בחרי סניף</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}{b.city ? ` · ${b.city}` : ''}</option>)}
          </select>
          {touched && errors.branch_id && <span className="mt-0.5 block text-xs text-bad">{errors.branch_id}</span>}
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={form.mailing_consent} onChange={(e) => set('mailing_consent', e.target.checked)} />
          <span>אני מאשרת הצטרפות לרשימת התפוצה במייל ולקו החוג (עדכונים על שיעורים, מופעים וצילומים)</span>
        </label>

        <section className="rounded-field border border-rule bg-shade/50 p-3 text-sm">
          <p className="font-medium">מבנה התשלום</p>
          <p className="mt-1 text-soft">{describePlan(plan)}</p>
        </section>

        <section className="rounded-field border border-rule p-3 text-sm">
          <button type="button" className="flex w-full items-center justify-between font-medium" onClick={() => setTermsOpen((o) => !o)} aria-expanded={termsOpen}>
            <span>התקנון</span><span className="text-soft">{termsOpen ? 'סגירה' : 'לקריאה'}</span>
          </button>
          <div className={`mt-2 whitespace-pre-wrap text-soft ${termsOpen ? '' : 'max-h-40 overflow-y-auto'}`}>{terms}</div>
          <label className="mt-3 flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={form.terms_accepted} onChange={(e) => set('terms_accepted', e.target.checked)} />
            <span>קראתי את התקנון ואני מאשרת אותו</span>
          </label>
          {touched && errors.terms_accepted && <span className="mt-0.5 block text-xs text-bad">{errors.terms_accepted}</span>}
        </section>

        {result && !result.ok && <p className="text-sm text-bad" role="alert">{result.error}</p>}
        <button type="submit" className="btn-primary w-full text-base" disabled={busy || !form.terms_accepted}>
          {busy ? 'שולחת…' : 'הרשמה ומעבר לתשלום'}
        </button>
      </form>
    </main>
  );
}
