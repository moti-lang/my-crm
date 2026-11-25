import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { humanError } from '@/lib/errors';
import { useBotPaused, useSetBotPaused } from '@/hooks/agent';

type Mode = { dryRun: boolean; testPhoneTail: string | null };
type WaAdmin = {
  ok: boolean; configured?: boolean; error?: string; mode?: Mode; host?: string; phone?: string | null;
  state?: 'connected' | 'reconnecting' | 'logged_out' | 'qr' | null;
  qrDataUrl?: string | null; qrSeconds?: number | null;
};

async function callWaAdmin(action: 'status' | 'connect' | 'disconnect'): Promise<WaAdmin> {
  const { data, error } = await supabase.functions.invoke('wa-admin', { body: { action } });
  if (error) {
    // שגיאת השרת (502) מגיעה עם גוף — מציגים את ההודעה שלו.
    const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
    if (body) return body as WaAdmin;
    throw error;
  }
  return data as WaAdmin;
}

/** מתג הבוט: כבוי = מתכתבים ישירות מהטלפון, הודעות נכנסות לא מגיעות למערכת. */
function BotSwitch() {
  const paused = useBotPaused();
  const set = useSetBotPaused();
  if (paused.isLoading) return null;
  const on = paused.data !== true;
  return (
    <div className={`rounded-field border p-3 ${on ? 'border-rule' : 'border-warn/50 bg-warn/10'}`}>
      <label className="flex items-center justify-between gap-3">
        <span>
          <b>{on ? 'הבוט פעיל' : 'הבוט כבוי'}</b>
          <span className="block text-xs text-soft">
            {on
              ? 'הודעות נכנסות מגיעות למערכת: הסוכן עונה להורים ופקודות מבוצעות.'
              : 'הודעות נכנסות לא מגיעות למערכת ולא מקבלות תשובה אוטומטית. אפשר להתכתב ישירות מהטלפון.'}
          </span>
        </span>
        <input type="checkbox" role="switch" aria-label="הבוט פעיל" className="h-5 w-5 shrink-0" checked={on} disabled={set.isPending}
          onChange={(e) => set.mutate(!e.target.checked)} />
      </label>
      {set.error != null && <p className="mt-1 text-xs text-bad" role="alert">{humanError(set.error)}</p>}
    </div>
  );
}

/** מצב השליחה — מה באמת יוצא. נקבע רק במשתני הסביבה של השרת (לא מכאן). */
function ModeBanner({ mode }: { mode: Mode | undefined }) {
  if (!mode) return null;
  if (mode.testPhoneTail) {
    return (
      <p className="rounded-field border border-warn/50 bg-warn/10 p-3 text-xs" data-testid="wa-mode">
        <b>מצב בדיקה:</b> הודעות יוצאות באמת <b>רק למספר הבדיקה</b> (מסתיים ב-{mode.testPhoneTail}). לכל השאר — שום דבר לא נשלח.
      </p>
    );
  }
  if (mode.dryRun) {
    return (
      <p className="rounded-field border border-plum/40 bg-plum/5 p-3 text-xs" data-testid="wa-mode">
        <b>מצב צפייה:</b> הסוכן מנסח תשובות לכל הודעה, אבל <b>שום דבר לא נשלח</b> — לא תשובות ולא תזכורות.
        את הטיוטות רואים בסוכן ← שיחות. להפעלת שליחה אמיתית — לבקש מ-Claude.
      </p>
    );
  }
  return <p className="rounded-field border border-ok/40 bg-ok/5 p-3 text-xs" data-testid="wa-mode"><b>שליחה פעילה:</b> הודעות יוצאות להורים.</p>;
}

type Pacing = { min_gap_seconds: number; max_gap_seconds: number; max_per_minute: number };
const PACING_DEFAULT: Pacing = { min_gap_seconds: 8, max_gap_seconds: 20, max_per_minute: 4 };

/**
 * ★ קצב שליחת התור (הגדרות, לא קשיח בקוד): הודעות רבות באותו נוסח הן מה שוואטסאפ חוסם עליו.
 *   השרת אוכף את התקרה, וחותך ערכים קיצוניים (f_wa_pacing).
 */
function PacingSettings() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['wa-pacing'],
    queryFn: async () => {
      const { data, error } = await supabase.from('settings').select('value').eq('key', 'wa_pacing').maybeSingle();
      if (error) throw new Error(error.message);
      return { ...PACING_DEFAULT, ...((data?.value ?? {}) as Partial<Pacing>) };
    },
  });
  const [draft, setDraft] = useState<Pacing | null>(null);
  useEffect(() => { if (q.data) setDraft(q.data); }, [q.data]);
  const save = useMutation({
    mutationFn: async (p: Pacing) => {
      const { data: cur } = await supabase.from('settings').select('value').eq('key', 'wa_pacing').maybeSingle();
      const { error } = await supabase.from('settings').upsert({ key: 'wa_pacing', value: { ...((cur?.value ?? {}) as object), ...p } }, { onConflict: 'key' });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['wa-pacing'] }); },
  });
  if (!draft) return null;
  const valid = draft.min_gap_seconds >= 1 && draft.max_gap_seconds >= draft.min_gap_seconds && draft.max_gap_seconds <= 600
    && draft.max_per_minute >= 1 && draft.max_per_minute <= 60;
  const num = (k: keyof Pacing, label: string) => (
    <label className="block text-xs">{label}
      <input className="field mt-0.5 w-24" inputMode="numeric" value={String(draft[k])} aria-label={label}
        onChange={(e) => { save.reset(); setDraft({ ...draft, [k]: Number(e.target.value.replace(/\D/g, '') || 0) }); }} />
    </label>
  );
  return (
    <div className="space-y-2 rounded-field border border-rule p-3" data-testid="wa-pacing">
      <p className="text-xs"><b>קצב שליחת תזכורות</b> — מרווח אקראי בין הודעות, ותקרה לדקה. הודעות רבות באותו נוסח ברצף — זה מה שוואטסאפ חוסם עליו.</p>
      <div className="flex flex-wrap gap-3">
        {num('min_gap_seconds', 'מרווח מינימלי (שניות)')}
        {num('max_gap_seconds', 'מרווח מקסימלי (שניות)')}
        {num('max_per_minute', 'עד הודעות בדקה')}
      </div>
      {!valid && <p className="text-xs text-bad" role="alert">מרווח 1–600 שניות (המקסימום לא קטן מהמינימום), ו-1–60 הודעות בדקה.</p>}
      {save.error != null && <p className="text-xs text-bad" role="alert">{humanError(save.error)}</p>}
      {save.isSuccess && <p className="text-xs text-ok" role="status">✓ נשמר</p>}
      <button type="button" className="btn-ghost px-3 py-1 text-xs" disabled={!valid || save.isPending} onClick={() => save.mutate(draft)}>
        {save.isPending ? 'שומרת…' : 'שמירת הקצב'}
      </button>
    </div>
  );
}

/**
 * חיבור מספר הוואטסאפ (GOWA): מצב, QR לסריקה ישירות מהמסך, וניתוק. בעלים בלבד.
 * הסיסמה של GOWA לא מגיעה לדפדפן — רק מצב ותמונת QR (דרך wa-admin).
 */
export function WaConnect() {
  const qc = useQueryClient();
  const [qr, setQr] = useState<{ url: string; seconds: number | null } | null>(null);
  const q = useQuery({ queryKey: ['wa-admin'], queryFn: () => callWaAdmin('status'), refetchInterval: qr ? 3000 : false });
  const act = useMutation({
    mutationFn: callWaAdmin,
    onSuccess: (d) => {
      if (d.state === 'qr' && d.qrDataUrl) setQr({ url: d.qrDataUrl, seconds: d.qrSeconds ?? null });
      else { setQr(null); qc.setQueryData(['wa-admin'], d); }
    },
  });
  const s = q.data;
  // אחרי הסריקה — המצב מתחלף ל"מחובר", והקוד נעלם.
  useEffect(() => { if (s?.state === 'connected' || s?.state === 'reconnecting') setQr(null); }, [s?.state]);

  if (q.isLoading) return <p className="text-sm text-soft">בודקת את חיבור הוואטסאפ…</p>;
  if (q.isError) return <p className="text-sm text-bad" role="alert">{humanError(q.error)}</p>;
  if (s && !s.configured) {
    return (
      <div className="space-y-3 text-sm" data-testid="wa-not-configured">
        <p><b>וואטסאפ לא מוגדר.</b> <span className="text-soft">החיבור לשרת הוואטסאפ (GOWA) עוד לא הוגדר במערכת. אחרי שיוגדר, תופיע כאן אפשרות לסרוק QR.</span></p>
        <ModeBanner mode={s.mode} />
        <PacingSettings />
      </div>
    );
  }
  if (!s?.ok) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-bad" role="alert">{s?.error ?? 'שרת הוואטסאפ לא עונה'}</p>
        <button type="button" className="btn-ghost text-xs" onClick={() => void q.refetch()}>בדיקה חוזרת</button>
      </div>
    );
  }
  return (
    <div className="space-y-3 text-sm">
      <BotSwitch />
      <ModeBanner mode={s.mode} />
      {qr ? (
        <div className="space-y-2" data-testid="wa-qr">
          <p>בטלפון של החוג: <b>וואטסאפ ← הגדרות ← מכשירים מקושרים ← קישור מכשיר</b>, וסורקים:</p>
          <img src={qr.url} alt="קוד QR לחיבור וואטסאפ" className="mx-auto h-64 w-64 rounded-field bg-white p-2" />
          <p className="text-xs text-soft">
            {qr.seconds ? `הקוד תקף כ-${qr.seconds} שניות. ` : ''}אחרי הסריקה המסך יתעדכן תוך כמה שניות. פג? "קוד חדש".
          </p>
        </div>
      ) : s.state === 'connected' ? (
        <p className="text-ok" data-testid="wa-state">מחובר{s.phone ? ` · ${s.phone}` : ''}</p>
      ) : s.state === 'reconnecting' ? (
        <p className="text-warn" data-testid="wa-state">המספר מקושר, והחיבור לוואטסאפ מתחדש…</p>
      ) : (
        <p className="text-soft" data-testid="wa-state">לא מחובר — צריך לסרוק QR.</p>
      )}
      <div className="flex gap-2">
        {s.state !== 'connected' && s.state !== 'reconnecting' && (
          <button type="button" className="btn-primary text-xs" disabled={act.isPending} onClick={() => act.mutate('connect')}>
            {act.isPending ? 'מכינה QR…' : qr ? 'קוד חדש' : 'חיבור מספר (QR)'}
          </button>
        )}
        {(s.state === 'connected' || s.state === 'reconnecting') && (
          <button type="button" className="btn-ghost text-xs text-bad" disabled={act.isPending}
            onClick={() => { if (window.confirm('לנתק את מספר הוואטסאפ מהמערכת? הודעות לא יישלחו עד חיבור מחדש.')) act.mutate('disconnect'); }}>
            ניתוק המספר
          </button>
        )}
      </div>
      {act.data && !act.data.ok && <p className="text-xs text-bad" role="alert">{act.data.error}</p>}
      {act.error != null && <p className="text-xs text-bad" role="alert">{humanError(act.error)}</p>}
      <PacingSettings />
      {s.host && <p className="text-xs text-soft" dir="ltr">{s.host}</p>}
    </div>
  );
}
