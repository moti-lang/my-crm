import { useMemo, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { useEnrollmentPublic, enroll, type EnrollResult } from '@/hooks/enrollment';
import { validateEnroll, describeTrack, enrollTokenFromPath, type EnrollForm, type EnrollQuestions } from '@/lib/enrollment';
import { formatILS } from '@/lib/format';

/**
 * /enroll/<טוקן> — דף ההרשמה הציבורי של סניף אחד. מחוץ ל-AuthProvider.
 * הקישור קובע את הסניף: ההורה רואה רק את התקנון והמחיר שלו, ולא בוחרת סניף.
 * הכל מהמסד: שם החוג, התקנון, מבנה התשלום. השליחה היא RPC אחד
 * (rpc_enroll) שמאמת שדות ומגביל קצב במסד; הדף לא נוגע בטבלאות.
 * בסיום: קישור התשלום על החיוב הראשון מוצג מיד, ונשלח גם בוואטסאפ.
 */
const EMPTY: EnrollForm = { first_name: '', last_name: '', grade: '', school: '', phone: '', email: '', mailing_consent: false, terms_accepted: false, whatsapp: '', photo: '', track: '' };
const NO_QUESTIONS: EnrollQuestions = { whatsapp: false, photo: false, track: false };

export function Enroll() {
  const token = enrollTokenFromPath(useLocation().pathname);
  const info = useEnrollmentPublic(token);
  const [form, setForm] = useState<EnrollForm>(EMPTY);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EnrollResult | null>(null);
  const [termsOpen, setTermsOpen] = useState(false);
  const questions = info.data?.ok ? info.data.questions : NO_QUESTIONS;
  const errors = useMemo(() => validateEnroll(form, questions), [form, questions]);
  const set = <K extends keyof EnrollForm>(k: K, v: EnrollForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length) return;
    setBusy(true);
    try { setResult(await enroll({ ...form, enroll_token: token })); }
    catch { setResult({ ok: false, error: 'לא הצלחנו לשלוח את ההרשמה. בדקי את החיבור ונסי שוב.' }); }
    finally { setBusy(false); }
  }

  if (info.isLoading) return <main className="p-6 text-center text-sm text-soft">טוען…</main>;
  if (info.isError || !info.data) return <main className="p-6 text-center text-sm text-bad">ההרשמה אינה זמינה כרגע. נסי שוב מאוחר יותר.</main>;
  if (!info.data.ok) return <main className="p-6 text-center text-sm text-bad">{info.data.error}</main>;
  const { program_name, terms, branch, open, closed_reason, tracks, photo_consent_text } = info.data;

  if (result?.ok) {
    return (
      <main className="mx-auto max-w-md space-y-4 p-5 text-ink">
        <header className="text-center">{program_name && <p className="text-xs text-soft">{program_name}</p>}<h1 className="text-2xl">ההרשמה נקלטה 🌸</h1></header>
        <section className="card space-y-3 p-5">
          {result.method === 'external' ? (
            <p className="text-sm">{result.student} רשומה ל{result.branch}. ההרשמה אושרה, נתראה בקרוב!</p>
          ) : result.method === 'cash' || !result.pay_url ? (
            <>
              <p className="text-sm">{result.student} רשומה ל{result.branch}, במסלול: {result.track}.</p>
              {result.amount != null && <p className="text-center font-display text-3xl tabular-nums">{formatILS(result.amount)}</p>}
              <p className="text-sm text-soft">התשלום במזומן מתקבל בסניף. ההרשמה תאושר סופית כשהתשלום יירשם.</p>
            </>
          ) : (
            <>
              <p className="text-sm">{result.student} רשומה ל{result.branch}, במסלול: {result.track}. כדי להשלים את ההרשמה נשאר התשלום:</p>
              <p className="text-center font-display text-3xl tabular-nums">{formatILS(result.amount)}</p>
              <a href={result.pay_url} className="btn-primary block w-full text-center text-base">לתשלום בכרטיס אשראי</a>
              <p className="text-center text-xs text-soft">
                {form.whatsapp === 'no' ? 'שמרי את הקישור: הוא תקף 7 ימים.' : 'הקישור נשלח אלייך גם בוואטסאפ, ותקף 7 ימים.'} ההרשמה תאושר סופית אחרי התשלום.
              </p>
            </>
          )}
          {result.whatsapp_group_url && (
            <a href={result.whatsapp_group_url} target="_blank" rel="noopener noreferrer"
              className="btn-ghost block w-full text-center text-base">הצטרפות לקבוצת הוואטסאפ של הסניף</a>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md space-y-4 p-5 text-ink">
      <header className="text-center">
        {program_name && <p className="text-xs text-soft">{program_name}</p>}
        <h1 className="text-2xl">הרשמה · {branch.name}</h1>
        {(branch.schedule || branch.age_groups) && (
          <p className="mt-1 text-sm text-soft">{[branch.schedule, branch.age_groups].filter(Boolean).join(' · ')}</p>
        )}
      </header>
      {!open ? (
        <section className="card p-5 text-center text-sm">
          {closed_reason === 'full'
            ? 'ההרשמה לסניף מלאה. אפשר לפנות אלינו לרשימת המתנה.'
            : 'ההרשמה לסניף סגורה כרגע.'}
        </section>
      ) : (
      <form onSubmit={submit} className="card space-y-3 p-5" noValidate>
        <div className="grid grid-cols-2 gap-2">
          <Field k="first_name" label="שם פרטי" form={form} set={set} error={touched ? errors.first_name : undefined} />
          <Field k="last_name" label="שם משפחה" form={form} set={set} error={touched ? errors.last_name : undefined} />
          <Field k="grade" label="כיתה" form={form} set={set} error={touched ? errors.grade : undefined} />
          <Field k="school" label="בית ספר" form={form} set={set} error={touched ? errors.school : undefined} />
        </div>
        <Field k="phone" label="טלפון (נייד)" type="tel" dir="ltr" form={form} set={set} error={touched ? errors.phone : undefined} />
        <Field k="email" label="מייל" type="email" dir="ltr" form={form} set={set} error={touched ? errors.email : undefined} />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={form.mailing_consent} onChange={(e) => set('mailing_consent', e.target.checked)} />
          <span>אני מאשרת הצטרפות לרשימת התפוצה במייל ולקו העדכונים (עדכונים על שיעורים, מופעים וצילומים)</span>
        </label>

        {questions.whatsapp && (
          <YesNo label="האם אתם מקבלים הודעות וואטסאפ (לעדכונים)?" value={form.whatsapp} onChange={(v) => set('whatsapp', v)}
            error={touched ? errors.whatsapp : undefined} />
        )}

        {questions.photo && (
          <section className="rounded-field border border-rule p-3 text-sm">
            <p className="whitespace-pre-wrap text-soft">{photo_consent_text}</p>
            <YesNo label="אישור לצילום" value={form.photo} onChange={(v) => set('photo', v)} error={touched ? errors.photo : undefined} />
          </section>
        )}

        {questions.track && (
          <fieldset className="rounded-field border border-rule p-3 text-sm">
            <legend className="px-1 font-medium">אני משלמת:</legend>
            <div className="space-y-2">
              {tracks.map((t) => (
                <label key={t.key} className={`flex cursor-pointer items-start gap-2 rounded-field border p-2 ${form.track === t.key ? 'border-plum bg-plum/5' : 'border-rule'}`}>
                  <input type="radio" name="track" className="mt-1" checked={form.track === t.key} onChange={() => set('track', t.key)} />
                  <span><span className="font-medium">{t.label}</span><span className="block text-xs text-soft">{describeTrack(t)}</span></span>
                </label>
              ))}
            </div>
            {touched && errors.track && <span className="mt-1 block text-xs text-bad">{errors.track}</span>}
          </fieldset>
        )}

        <section className="rounded-field border border-rule p-3 text-sm">
          <button type="button" className="flex w-full items-center justify-between font-medium" onClick={() => setTermsOpen((o) => !o)} aria-expanded={termsOpen}>
            <span>התקנון</span><span className="text-soft">{termsOpen ? 'סגירה' : 'לקריאה'}</span>
          </button>
          <div className={`mt-2 whitespace-pre-wrap text-soft ${termsOpen ? '' : 'max-h-40 overflow-y-auto'}`}><Linkified text={terms} /></div>
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
      )}
    </main>
  );
}

/**
 * מחוץ ל-Enroll בכוונה: רכיב שמוגדר בתוך רכיב אחר נוצר מחדש בכל רינדור,
 * React מחליף את ה-input, והפוקוס נופל אחרי כל אות.
 */
type TextKey = 'first_name' | 'last_name' | 'grade' | 'school' | 'phone' | 'email';
function Field({ k, label, type = 'text', dir, form, set, error }:
  { k: TextKey; label: string; type?: string; dir?: string; form: EnrollForm; set: (k: TextKey, v: string) => void; error?: string }) {
  return (
    <label className="block text-sm">{label}
      <input type={type} dir={dir} className="field mt-1" value={form[k]} onChange={(e) => set(k, e.target.value)} autoComplete="off" />
      {error && <span className="mt-0.5 block text-xs text-bad">{error}</span>}
    </label>
  );
}

/** שאלת כן/לא — חובה, בלי ברירת מחדל: ההורה בוחרת בעצמה. */
function YesNo({ label, value, onChange, error }: { label: string; value: '' | 'yes' | 'no'; onChange: (v: 'yes' | 'no') => void; error?: string }) {
  return (
    <fieldset className="text-sm">
      <legend>{label}</legend>
      <div className="mt-1 flex gap-2">
        {(['yes', 'no'] as const).map((v) => (
          <label key={v} className={`cursor-pointer rounded-btn border px-4 py-1 ${value === v ? 'border-plum bg-plum text-white' : 'border-rule'}`}>
            <input type="radio" className="sr-only" checked={value === v} onChange={() => onChange(v)} />{v === 'yes' ? 'כן' : 'לא'}
          </label>
        ))}
      </div>
      {error && <span className="mt-0.5 block text-xs text-bad">{error}</span>}
    </fieldset>
  );
}

/** טקסט עם קישורי https לחיצים (למשל קישור לקבוצה שהוקלד בתוך התקנון). בלי HTML מהטקסט. */
export function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https:\/\/[^\s]+)/g);
  return <>{parts.map((p, i) => (/^https:\/\//.test(p)
    ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="text-plum underline break-all">{p}</a>
    : <span key={i}>{p}</span>))}</>;
}
