import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';

type Info = { ok: boolean; email?: string; unsubscribed?: boolean };

/**
 * ציבורי: קישור ההסרה שבתחתית כל מייל להורים. הטוקן הוא ההרשאה (המסד מאמת).
 * ההסרה בלחיצה ולא בפתיחת הקישור: סורקי קישורים של תיבות דואר "פותחים" קישורים לבד.
 */
export function Unsubscribe() {
  const { token = '' } = useParams<{ token: string }>();
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void supabase.rpc('rpc_email_unsubscribe', { p_token: token, p_confirm: false })
      .then(({ data, error: e }) => { if (e) setError('לא הצלחנו לטעון. נסי שוב בעוד רגע.'); else setInfo(data as Info); });
  }, [token]);

  async function confirm() {
    setBusy(true); setError(null);
    const { data, error: e } = await supabase.rpc('rpc_email_unsubscribe', { p_token: token, p_confirm: true });
    setBusy(false);
    if (e) setError('ההסרה לא הצליחה. נסי שוב בעוד רגע.'); else setInfo(data as Info);
  }

  return (
    <main dir="rtl" className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl">הסרה מרשימת התפוצה</h1>
      {error && <p className="text-bad" role="alert">{error}</p>}
      {!info && !error && <p className="text-soft">טוען…</p>}
      {info && !info.ok && <p>הקישור לא תקף. אם קיבלת מאיתנו מייל, אפשר להשתמש בקישור שבתחתיתו.</p>}
      {info?.ok && info.unsubscribed && (
        <p role="status">הכתובת <span dir="ltr">{info.email}</span> הוסרה מרשימת התפוצה. לא יישלחו אלייך עוד מיילים מאיתנו.</p>
      )}
      {info?.ok && !info.unsubscribed && (
        <>
          <p>להסיר את <span dir="ltr">{info.email}</span> מרשימת התפוצה במייל?</p>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void confirm()}>{busy ? 'מסירה…' : 'כן, להסיר אותי'}</button>
        </>
      )}
    </main>
  );
}
