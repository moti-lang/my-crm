import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router-dom';

/**
 * מצב של מסך רשימה שנשמר כשנכנסים לפריט ויוצאים ממנו.
 *
 * הלקוחה עובדת ברצף על כמה תלמידות: מחפשת, נכנסת לכרטיס, יוצאת — והחיפוש התאפס.
 * הסיבות: הכרטיס לא היה רשומה בהיסטוריה (כפתור "חזרה" בטלפון יצא מהמסך כולו), ומצב
 * הרשימה חי רק בזיכרון של הקומפוננטה (כל יציאה מהמסך מחקה אותו).
 *
 *  · useListParams — חיפוש, סינונים, מיון: בכתובת (?q=…&branch=…), בהחלפה ולא בדחיפה,
 *    כך ש"חזרה" מפריט מחזירה בדיוק לאותה כתובת ולאותו מצב. כניסה רגילה מהתפריט — רשימה נקייה.
 *  · useOpenItem — כרטיס שנפתח מעל הרשימה (מגירה) הוא רשומה בהיסטוריה: "חזרה" סוגרת אותו.
 *  · useScrollMemory — מיקום הגלילה נשמר תוך כדי גלילה ומשוחזר בחזרה (POP) אחרי שהנתונים נטענו.
 */

/** ערכי ברירת מחדל לא נכתבים לכתובת — כתובת נקייה = רשימה מלאה. */
export function useListParams<K extends string>(defaults: Readonly<Record<K, string>>) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const keys = Object.keys(defaults) as K[];
  const values = useMemo(() => {
    const out = {} as Record<K, string>;
    for (const k of keys) out[k] = params.get(k) ?? defaults[k];
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const set = useCallback((patch: Partial<Record<K, string>>) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch) as [K, string | undefined][]) {
        if (v === undefined || v === '' || v === defaults[k]) next.delete(k); else next.set(k, v);
      }
      return next;
    // החלפה: כל הקשה בחיפוש לא הופכת לרשומה בהיסטוריה. ה-state של הרשומה (למשל "נפתח מהרשימה") נשמר.
    }, { replace: true, state: location.state });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setParams, location.state]);

  return [values, set] as const;
}

type Opened = { openedFromList?: boolean } | null;

/** פריט שנפתח מעל הרשימה (?student=…). פתיחה = רשומה חדשה בהיסטוריה; סגירה = חזרה אליה. */
export function useOpenItem(param: string) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const openId = params.get(param);
  // סגירה פעם אחת בלבד לכל פתיחה: שתי סגירות (מחיקה סוגרת, וגם "התלמידה כבר לא ברשימה")
  // היו חוזרות אחורה פעמיים — ויוצאות מהמסך.
  // ★ המצב נקרא מ-ref ולא מה-closure: סגירה שמחכה בהבטחה (המחיקה) מחזיקה עותק ישן של close,
  //   שבו הפריט עוד "פתוח". והשומר מתאפס רק בפתיחה חדשה — לא כשהפריט נסגר.
  const closing = useRef(false);
  const current = useRef({ openId, state: location.state as Opened });
  current.current = { openId, state: location.state as Opened };
  useEffect(() => { if (openId) closing.current = false; }, [openId]);

  const open = useCallback((id: string) => {
    const next = new URLSearchParams(params);
    next.set(param, id);
    setParams(next, { state: { openedFromList: true } });
  }, [params, param, setParams]);

  const close = useCallback(() => {
    if (!current.current.openId || closing.current) return;
    closing.current = true;
    // נפתח מהרשימה → חוזרים אחורה (כמו כפתור "חזרה"), כך שההיסטוריה לא מתמלאת.
    // הגיעו ישר לכתובת עם הפריט → רק מסירים אותו מהכתובת.
    if (current.current.state?.openedFromList) { navigate(-1); return; }
    setParams((prev) => { const next = new URLSearchParams(prev); next.delete(param); return next; }, { replace: true });
  }, [navigate, param, setParams]);

  return { openId, open, close };
}

const scrollKey = (pathname: string) => `list-scroll:${pathname}`;

/**
 * מיקום הגלילה במסך הזה. נשמר תוך כדי גלילה (ולא ביציאה — אז הדף כבר התחלף ונחתך),
 * ומשוחזר רק בחזרה (POP: "חזרה" בדפדפן או מפריט), אחרי ש-ready (הרשימה מוצגת).
 * כניסה מהתפריט (PUSH) מתחילה מלמעלה.
 */
export function useScrollMemory(ready: boolean) {
  const { pathname, search, key } = useLocation();
  const navType = useNavigationType();
  const settled = useRef(navType !== 'POP');

  // כניסה מהתפריט — גם כשכבר נמצאים במסך (אז הוא לא נטען מחדש): כתובת נקייה מתחילה מלמעלה.
  // פתיחת כרטיס (?student=…) או שינוי סינון אינם כתובת נקייה, ולכן לא קופצים.
  useEffect(() => {
    // השחזור שלנו בלבד. השחזור האוטומטי של הדפדפן קורה ברגע ה"חזרה", כשהרשימה עוד לא
    // מוצגת — נחתך, ותלוי בתזמון.
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
  }, []);

  useEffect(() => {
    if (settled.current && navType === 'PUSH' && !search) window.scrollTo(0, 0);
  // לכל ניווט (key), לא לכל שינוי.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (settled.current || !ready) return;
    let y = 0;
    try { y = Number(sessionStorage.getItem(scrollKey(pathname)) ?? 0); } catch { /* אין אחסון — מתחילים מלמעלה */ }
    // אחרי הציור: עד אז הדף קצר מדי והגלילה נחתכת.
    const id = requestAnimationFrame(() => { window.scrollTo(0, y); settled.current = true; });
    return () => cancelAnimationFrame(id);
  }, [ready, pathname]);

  useEffect(() => {
    let frame = 0;
    const save = () => {
      if (!settled.current || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        try { sessionStorage.setItem(scrollKey(pathname), String(Math.round(window.scrollY))); } catch { /* אין אחסון */ }
      });
    };
    window.addEventListener('scroll', save, { passive: true });
    return () => { window.removeEventListener('scroll', save); cancelAnimationFrame(frame); };
  }, [pathname]);
}

/** קישור מפריט חזרה לרשימה: אם הגיעו מהרשימה — "חזרה" אמיתית (עם החיפוש והגלילה). */
export function useBackToList() {
  const location = useLocation();
  const navigate = useNavigate();
  const fromList = Boolean((location.state as { fromList?: boolean } | null)?.fromList);
  return useCallback((e?: { preventDefault: () => void }) => {
    if (!fromList) return; // הגיעו ישירות (קישור, רענון) — הקישור הרגיל לרשימה עושה את שלו
    e?.preventDefault();
    navigate(-1);
  }, [fromList, navigate]);
}

/** state שמסמן "נכנסתי לפריט מהרשימה" — לשימוש ב-<Link state={FROM_LIST}>. */
export const FROM_LIST = { fromList: true } as const;
