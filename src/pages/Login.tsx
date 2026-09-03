import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';

/**
 * כניסה בגוגל בלבד. אין אימייל וסיסמה — לא במסך ולא במערכת.
 * מי שאינה ברשימת המורשים תוחזר לכאן עם דחייה מהמסד (ראה NoAccess).
 */
export function Login() {
  const { signInWithGoogle } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
      // הדפדפן עובר לגוגל; אם חזרנו לכאן בלי מעבר — משהו נכשל.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ההתחברות נכשלה.');
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="card w-full max-w-sm p-6 shadow-pop">
        <h1 className="font-display text-xl text-ink">החוג של הניה טייכטל</h1>
        <p className="mt-1 text-sm text-soft">מערכת הניהול</p>

        <button type="button" onClick={onClick} className="btn-primary mt-6 w-full" disabled={busy}>
          <GoogleMark />
          {busy ? 'מעבירה לגוגל…' : 'כניסה עם Google'}
        </button>

        {error && <p className="mt-4 text-sm text-bad" role="alert">{error}</p>}

        <p className="mt-6 text-xs leading-relaxed text-soft">
          הכניסה מיועדת למי שהוזמנה על ידי הבעלים. חשבון גוגל שאינו ברשימה לא יורשה להיכנס.
        </p>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden width="18" height="18" viewBox="0 0 48 48" className="shrink-0">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.5 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.8 6C12.3 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.4 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.7l7.8-6z" />
      <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.5-5.8c-2 1.4-4.7 2.3-7.7 2.3-6.3 0-11.7-4.1-13.6-9.8l-7.8 6C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}
