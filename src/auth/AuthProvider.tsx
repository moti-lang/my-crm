import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Tables } from '@/lib/database.types';

type Profile = Tables<'profiles'>;

type AuthValue = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  /** הודעת דחייה שחזרה מגוגל/GoTrue — בדרך כלל: האימייל אינו ברשימת המורשים. */
  denied: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

/**
 * GoTrue מחזיר שגיאת OAuth בכתובת החזרה — ב-hash (implicit) או ב-query
 * (PKCE): error, error_code, error_description. כשהטריגר במסד דוחה את
 * יצירת החשבון, זו הדרך היחידה שבה הדפדפן שומע על זה.
 */
export function oauthErrorFromUrl(): string | null {
  const sources = [
    new URLSearchParams(window.location.hash.replace(/^#/, '')),
    new URLSearchParams(window.location.search),
  ];
  for (const p of sources) {
    const desc = p.get('error_description') ?? p.get('error');
    if (desc) return desc;
  }
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    const err = oauthErrorFromUrl();
    if (err) {
      setDenied(err);
      // מנקים את הכתובת כדי שרענון לא יציג את אותה שגיאה שוב.
      window.history.replaceState(null, '', window.location.pathname);
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) {
        setProfile(null);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session?.user) return;
    let alive = true;
    setLoading(true);
    supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        setProfile(data);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [session]);

  const value: AuthValue = {
    session,
    profile,
    loading,
    denied,
    signInWithGoogle: async () => {
      setDenied(null);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (error) throw new Error(translateAuthError(error.message));
    },
    signOut: async () => {
      setDenied(null);
      await supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function translateAuthError(message: string): string {
  if (/rate limit/i.test(message)) return 'יותר מדי ניסיונות. נסי שוב בעוד כמה דקות.';
  if (/failed to fetch|network/i.test(message)) return 'אין חיבור לשרת. בדקי את החיבור ונסי שוב.';
  if (/provider is not enabled|unsupported provider/i.test(message)) return 'הכניסה בגוגל אינה מופעלת בפרויקט. פני לניהול.';
  return 'ההתחברות נכשלה. נסי שוב.';
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth חייב לרוץ בתוך AuthProvider');
  return ctx;
}

export const ROLE_LABEL: Record<Tables<'profiles'>['role'], string> = {
  owner: 'בעלים',
  branch_manager: 'מנהלת סניף',
  accountant: 'הנהלת חשבונות',
};
