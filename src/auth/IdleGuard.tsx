import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { ACTIVITY_EVENTS, idleState, isIdleExempt, secondsLeft, type IdleState } from '@/lib/idle';

/**
 * יציאה אוטומטית אחרי 30 דקות בלי פעילות, עם אזהרה דקה לפני.
 * מבוסס על חותמות זמן ולא על טיימר יחיד: טאב ברקע שהדפדפן האט,
 * או מחשב שנרדם — בחזרה לחלון המצב מחושב מיד מהשעון.
 * ראה src/lib/idle.ts.
 */
export function IdleGuard() {
  const { signOut } = useAuth();
  const { pathname } = useLocation();
  const exempt = isIdleExempt(pathname);
  const last = useRef(Date.now());
  const [state, setState] = useState<IdleState>('active');
  const [left, setLeft] = useState(0);

  useEffect(() => {
    if (exempt) return;
    const touch = () => {
      // באזהרה, פעילות רגילה לא מאפסת — רק הכפתור. אחרת תזוזת עכבר
      // מקרית תסגור את האזהרה בלי שמישהי ראתה אותה.
      if (idleState(last.current, Date.now()) === 'active') last.current = Date.now();
    };
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, touch, { passive: true });
    const tick = () => {
      const now = Date.now();
      const s = idleState(last.current, now);
      setState(s);
      setLeft(secondsLeft(last.current, now));
      if (s === 'expired') void signOut();
    };
    const id = window.setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, touch);
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [exempt, signOut]);

  if (exempt || state !== 'warning') return null;
  return (
    <div role="alertdialog" aria-live="assertive" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="w-full max-w-sm rounded-card bg-paper p-5 shadow-xl">
        <h2 className="text-lg font-medium">עדיין כאן?</h2>
        <p className="mt-2 text-sm text-soft">
          לא הייתה פעילות חצי שעה. המערכת תתנתק בעוד <span className="tabular-nums font-medium text-ink">{left}</span> שניות
          כדי להגן על המידע אם המחשב נשאר פתוח.
        </p>
        <button
          type="button"
          autoFocus
          className="btn-primary mt-4 w-full"
          onClick={() => { last.current = Date.now(); setState('active'); }}
        >
          אני כאן, להמשיך
        </button>
      </div>
    </div>
  );
}
