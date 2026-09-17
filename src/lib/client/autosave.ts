/**
 * בקר שמירה אוטומטית (ללא תלות ב-React): צובר שינויים, שומר אחרי debounce או מיד,
 * מדווח מצב, ובכשל שומר את השינויים לניסיון חוזר. באופליין — מעביר לתור הסנכרון.
 */
export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error" | "queued";

export interface SaveState {
  status: SaveStatus;
  message?: string;
  at?: number;
}

export interface AutosaveOptions<P extends object> {
  /** שליחת השינויים לשרת. זורק שגיאה בכשל. */
  request: (patch: P) => Promise<unknown>;
  /** גיבוי אופליין: מכניס את השינויים לתור. אם לא ניתן — נשאר במצב שגיאה. */
  enqueue?: (patch: P) => Promise<unknown>;
  /** האם השגיאה היא ניתוק רשת (אז נכנס לתור במקום שגיאה) */
  isOffline?: (error: unknown) => boolean;
  onSaved?: (patch: P, result: unknown) => void;
  onState?: (state: SaveState) => void;
  /** debounce במילישניות (ברירת מחדל 800) */
  delay?: number;
  /** כמה זמן להציג "נשמר" לפני חזרה ל-idle (ברירת מחדל 2000) */
  savedTtl?: number;
}

export interface Autosave<P extends object> {
  save(patch: Partial<P>, immediate?: boolean): void;
  flush(): Promise<void>;
  retry(): Promise<void>;
  getState(): SaveState;
  getPending(): Partial<P> | null;
  dispose(): void;
}

export function createAutosave<P extends object>(opts: AutosaveOptions<P>): Autosave<P> {
  const delay = opts.delay ?? 800;
  const savedTtl = opts.savedTtl ?? 2000;
  let pending: Partial<P> | null = null;
  let inFlight: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let savedTimer: ReturnType<typeof setTimeout> | null = null;
  let state: SaveState = { status: "idle" };
  let disposed = false;

  const setState = (s: SaveState) => {
    state = s;
    opts.onState?.(s);
  };
  const clearTimers = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  async function doFlush(): Promise<void> {
    if (!pending) return;
    if (inFlight) {
      await inFlight;
      return doFlush();
    }
    clearTimers();
    const snapshot = pending as P;
    pending = null;
    setState({ status: "saving" });
    inFlight = (async () => {
      try {
        const result = await opts.request(snapshot);
        if (savedTimer) clearTimeout(savedTimer);
        setState({ status: "saved", at: Date.now() });
        savedTimer = setTimeout(() => {
          if (state.status === "saved" && !pending) setState({ status: "idle" });
        }, savedTtl);
        opts.onSaved?.(snapshot, result);
      } catch (e) {
        if (opts.enqueue && opts.isOffline?.(e)) {
          try {
            await opts.enqueue(snapshot);
            setState({ status: "queued", message: "אין חיבור — השינוי נשמר במכשיר ויסונכרן אוטומטית" });
          } catch (qe) {
            pending = { ...snapshot, ...(pending ?? {}) };
            setState({ status: "error", message: (qe as Error).message || "לא הצלחתי לשמור" });
          }
        } else {
          // השינויים נשארים — הערך לא נמחק מהשדה, ואפשר לנסות שוב
          pending = { ...snapshot, ...(pending ?? {}) };
          setState({ status: "error", message: (e as Error).message || "השמירה נכשלה" });
        }
      } finally {
        inFlight = null;
      }
    })();
    await inFlight;
    if (pending && !disposed && state.status !== "error") {
      timer = setTimeout(() => void doFlush(), delay);
    }
  }

  return {
    save(patch, immediate = false) {
      if (disposed) return;
      pending = { ...(pending ?? {}), ...patch };
      if (state.status !== "saving") setState({ status: "dirty" });
      clearTimers();
      if (immediate) void doFlush();
      else timer = setTimeout(() => void doFlush(), delay);
    },
    flush: () => doFlush(),
    retry: () => doFlush(),
    getState: () => state,
    getPending: () => pending,
    dispose() {
      disposed = true;
      clearTimers();
      if (savedTimer) clearTimeout(savedTimer);
    },
  };
}
