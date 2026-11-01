import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { formatILS } from '@/lib/format';
import { BILLING_DAYS } from '@/lib/enrollment';

/**
 * /pay/<טוקן> — הדף הציבורי של ההורה. מחוץ ל-AuthProvider, כמו מסך האחראית.
 * מציג רק מה שהמסד מחזיר (שם פרטי, סניף, סכום, מצב), ולחיצה על "לתשלום"
 * מבקשת מהשרת ליצור את דף SUMIT עם הסכום מהרשומה — לא מהדפדפן.
 *
 * ★ החזרה מ-SUMIT (?returned=1) היא "תודה, בודקים" — לא אישור. "שולם"
 *   מופיע רק אחרי שהשרת שמע את זה מ-SUMIT ורשם את התשלום.
 */
type Info =
  | { ok: true; state: 'open'; student: string; branch: string; amount: number; expires_at: string; sumit_page_url: string | null;
      /** הוראת קבע: הנוסח המלא עם התאריכים. consented = כבר אושר (נשמר). billing_day — היום שהנוסח מחושב לפיו. */
      standing: { text: string; consented?: boolean; count?: number; each?: number; dates?: string[]; billing_day?: number | null } | null }
  | { ok: true; state: 'paid'; student: string; branch: string; amount: number; paid_at: string | null }
  | { ok: false; state?: 'expired'; error: string };

export function Pay() {
  const { token = '' } = useParams<{ token: string }>();
  const [params] = useSearchParams();
  const returned = params.get('returned') === '1';
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ★ אישור הוראת הקבע: לא מסומן מראש. ההורה מסמנת בעצמה.
  const [agree, setAgree] = useState(false);
  const [program, setProgram] = useState<string | null>(null);
  // ★ יום החיוב בהוראת קבע — ההורה בוחרת כאן (דף האשראי של SUMIT לא מאפשר). בחרה בהרשמה — מוצג מראש.
  const [day, setDay] = useState('');

  async function load(forDay?: string) {
    const { data, error } = await supabase.rpc('rpc_payment_link_public', forDay ? { p_token: token, p_day: Number(forDay) } : { p_token: token });
    if (error) { setInfo({ ok: false, error: 'לא הצלחנו לטעון את הקישור. נסי שוב.' }); return; }
    const next = data as unknown as Info;
    setInfo(next);
    if (!forDay && next.ok && next.state === 'open' && next.standing && !next.standing.consented && next.standing.billing_day) {
      setDay(String(next.standing.billing_day));
    }
  }
  useEffect(() => { void load(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  /** יום אחר = נוסח ותאריכים אחרים: האישור מתבטל, והנוסח נטען מחדש מהשרת. */
  function chooseDay(v: string) {
    setDay(v); setAgree(false);
    if (v) void load(v);
  }
  // שם החוג של הסניף. ריק — לא מוצג שם.
  useEffect(() => { void supabase.rpc('rpc_payment_link_program', { p_token: token }).then(({ data }) => setProgram((data as string | null) ?? null)); }, [token]);
  // ★ אחרי חזרה מ-SUMIT: SUMIT מוסיפה לכתובת את מזהי התשלום. מעבירים אותם לשרת פעם אחת —
  //   השרת מאמת מול SUMIT את התשלום הזה בלבד. "שולם" לא נקבע כאן, רק בשרת.
  const pid = params.get('OG-PaymentID'), cid = params.get('OG-CustomerID'), ext = params.get('OG-ExternalIdentifier');
  const [confirmSent, setConfirmSent] = useState(false);
  useEffect(() => {
    if (!returned || !pid || confirmSent) return;
    setConfirmSent(true);
    const q = new URLSearchParams({ token, confirm: '1', pid, ext: ext ?? '' });
    if (cid) q.set('cid', cid);
    void supabase.functions.invoke(`sumit-checkout?${q.toString()}`, { method: 'POST' }).then(() => load());
  }, [returned, pid, cid, ext, confirmSent]); // eslint-disable-line react-hooks/exhaustive-deps
  // הנוסח שמוצג מחושב ליום שנבחר (לא נוסח קודם שעוד לא התעדכן) — רק אז אפשר לאשר.
  const standingNeedsDay = Boolean(info?.ok && info.state === 'open' && info.standing && !info.standing.consented);
  const dayReady = !standingNeedsDay || (day !== '' && info?.ok === true && info.state === 'open' && String(info.standing?.billing_day ?? '') === day);
  // אחרי חזרה מ-SUMIT: בודקים כל 5 שניות במשך 3 דקות אם השרת כבר רשם.
  useEffect(() => {
    if (!returned || (info?.ok && info.state === 'paid')) return;
    const id = window.setInterval(() => { void load(); }, 5000);
    const stop = window.setTimeout(() => window.clearInterval(id), 180_000);
    return () => { window.clearInterval(id); window.clearTimeout(stop); };
  }, [returned, info]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pay() {
    setBusy(true); setError(null);
    try {
      const consent = standingNeedsDay ? `&consent=1&day=${encodeURIComponent(day)}` : '';
      const { data, error } = await supabase.functions.invoke(`sumit-checkout?token=${encodeURIComponent(token)}${consent}`, { method: 'POST' });
      if (error) throw new Error(error.message);
      const r = data as { ok: boolean; url?: string; error?: string };
      if (!r.ok || !r.url) throw new Error(r.error ?? 'לא הצלחנו לפתוח את דף התשלום');
      window.location.href = r.url;
    } catch (e) {
      setError(e instanceof Error && /[֐-׿]/.test(e.message) ? e.message : 'לא הצלחנו לפתוח את דף התשלום כרגע. נסי שוב בעוד כמה דקות.');
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 bg-paper p-5 text-ink">
      <header className="text-center">
        {program && <p className="text-xs text-soft">{program}</p>}
        <h1 className="text-2xl">תשלום שכר לימוד</h1>
      </header>
      {!info ? (
        <p className="text-center text-sm text-soft">טוען…</p>
      ) : !info.ok ? (
        <section className="card p-5 text-center">
          <p className="text-lg">{info.state === 'expired' ? 'הקישור פג תוקף' : 'הקישור לא נמצא'}</p>
          <p className="mt-2 text-sm text-soft">{info.error}</p>
        </section>
      ) : info.state === 'paid' ? (
        <section className="card p-5 text-center">
          <p className="text-3xl">✓</p>
          <p className="mt-2 text-lg">התשלום התקבל, תודה!</p>
          <p className="mt-1 text-sm text-soft">{formatILS(info.amount)} עבור {info.student} ({info.branch}). הקבלה נשלחה אלייך.</p>
        </section>
      ) : (
        <section className="card space-y-4 p-5">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-soft">עבור</dt><dd>{info.student} · {info.branch}</dd></div>
            <div className="flex justify-between"><dt className="text-soft">סכום</dt><dd className="font-display text-xl tabular-nums">{formatILS(info.amount)}</dd></div>
          </dl>
          {returned ? (
            <div className="rounded-field bg-warn/10 p-3 text-sm">
              <p className="font-medium">תודה! אנחנו בודקים את התשלום מול חברת הסליקה.</p>
              <p className="mt-1 text-soft">זה לוקח בדרך כלל כמה שניות. אם שילמת והדף לא מתעדכן, אין צורך לשלם שוב — התשלום ייקלט אוטומטית והקבלה תגיע אלייך.</p>
            </div>
          ) : (
            <>
              {info.standing && (
                <div className="rounded-field border border-rule p-3 text-sm">
                  <p className="font-medium">הוראת קבע</p>
                  {info.standing.consented ? (
                    <p className="mt-1 text-soft">אישרת: {info.standing.text}</p>
                  ) : (
                    <>
                      <label className="mt-2 block">
                        <span>באיזה יום בחודש לחייב?</span>
                        <select className="field mt-1" aria-label="יום החיוב בחודש" value={day} onChange={(e) => chooseDay(e.target.value)}>
                          <option value="">בחרי יום</option>
                          {BILLING_DAYS.map((d) => <option key={d} value={String(d)}>{d} לחודש</option>)}
                        </select>
                      </label>
                      {dayReady ? (
                        <label className="mt-2 flex items-start gap-2">
                          <input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                          <span>{info.standing.text}</span>
                        </label>
                      ) : (
                        <p className="mt-2 text-xs text-soft">{day ? 'מעדכנת את התאריכים…' : 'אחרי שתבחרי יום יופיע כאן הנוסח לאישור, עם התאריכים המדויקים.'}</p>
                      )}
                    </>
                  )}
                </div>
              )}
              <button type="button" className="btn-primary w-full text-base"
                disabled={busy || Boolean(info.standing && !info.standing.consented && (!agree || !dayReady))} onClick={() => void pay()}>
                {busy ? 'פותח את דף התשלום…' : 'לתשלום בכרטיס אשראי'}
              </button>
              <p className="text-center text-xs text-soft">התשלום מתבצע בדף מאובטח של חברת הסליקה SUMIT. הקבלה תישלח אלייך אוטומטית.</p>
            </>
          )}
          {error && <p className="text-sm text-bad" role="alert">{error}</p>}
        </section>
      )}
    </main>
  );
}
