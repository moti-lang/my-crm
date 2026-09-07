import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { formatILS } from '@/lib/format';

/**
 * /pay/<טוקן> — הדף הציבורי של ההורה. מחוץ ל-AuthProvider, כמו מסך האחראית.
 * מציג רק מה שהמסד מחזיר (שם פרטי, סניף, סכום, מצב), ולחיצה על "לתשלום"
 * מבקשת מהשרת ליצור את דף SUMIT עם הסכום מהרשומה — לא מהדפדפן.
 *
 * ★ החזרה מ-SUMIT (?returned=1) היא "תודה, בודקים" — לא אישור. "שולם"
 *   מופיע רק אחרי שהשרת שמע את זה מ-SUMIT ורשם את התשלום.
 */
type Info =
  | { ok: true; state: 'open'; student: string; branch: string; amount: number; expires_at: string; sumit_page_url: string | null }
  | { ok: true; state: 'paid'; student: string; branch: string; amount: number; paid_at: string | null }
  | { ok: false; state?: 'expired'; error: string };

export function Pay() {
  const { token = '' } = useParams<{ token: string }>();
  const [params] = useSearchParams();
  const returned = params.get('returned') === '1';
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase.rpc('rpc_payment_link_public', { p_token: token });
    if (error) { setInfo({ ok: false, error: 'לא הצלחנו לטעון את הקישור. נסי שוב.' }); return; }
    setInfo(data as unknown as Info);
  }
  useEffect(() => { void load(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
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
      const { data, error } = await supabase.functions.invoke(`sumit-checkout?token=${encodeURIComponent(token)}`, { method: 'POST' });
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
        <p className="text-xs text-soft">החוג של הניה טייכטל</p>
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
              <button type="button" className="btn-primary w-full text-base" disabled={busy} onClick={() => void pay()}>
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
