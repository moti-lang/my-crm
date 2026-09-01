import { useState, type FormEvent } from 'react';
import { useAuth } from '@/auth/AuthProvider';

export function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ההתחברות נכשלה.');
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <form onSubmit={onSubmit} className="card w-full max-w-sm p-6 shadow-pop">
        <h1 className="font-display text-xl text-ink">החוג של הניה טייכטל</h1>
        <p className="mt-1 text-sm text-soft">התחברות למערכת הניהול</p>

        <label className="mt-6 block text-sm text-ink" htmlFor="email">אימייל</label>
        <input
          id="email" type="email" required autoComplete="username" dir="ltr"
          className="field mt-1" value={email} onChange={(e) => setEmail(e.target.value)}
        />

        <label className="mt-4 block text-sm text-ink" htmlFor="password">סיסמה</label>
        <input
          id="password" type="password" required autoComplete="current-password"
          className="field mt-1" value={password} onChange={(e) => setPassword(e.target.value)}
        />

        {error && <p className="mt-4 text-sm text-bad" role="alert">{error}</p>}

        <button type="submit" className="btn-primary mt-6 w-full" disabled={busy}>
          {busy ? 'מתחברת…' : 'כניסה'}
        </button>
      </form>
    </div>
  );
}
