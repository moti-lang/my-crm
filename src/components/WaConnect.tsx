import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { humanError } from '@/lib/errors';

type WaAdmin = {
  ok: boolean; configured?: boolean; server?: string; error?: string;
  state?: 'disconnected' | 'connecting' | 'qr' | 'connected' | 'logged_out' | null;
  qrDataUrl?: string | null; me?: { phone: string | null; name: string | null } | null;
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

/**
 * חיבור מספר הוואטסאפ: מצב, QR לסריקה ישירות מהמסך, וניתוק. בעלים בלבד.
 * מפתח ה-API של השרת לא מגיע לדפדפן — רק מצב ותמונת QR (דרך wa-admin).
 */
export function WaConnect() {
  const qc = useQueryClient();
  const [polling, setPolling] = useState(false);
  const q = useQuery({ queryKey: ['wa-admin'], queryFn: () => callWaAdmin('status'), refetchInterval: polling ? 3000 : false });
  const act = useMutation({
    mutationFn: callWaAdmin,
    onSuccess: (d) => { qc.setQueryData(['wa-admin'], d); },
  });
  const s = q.data;
  // בזמן QR / התחברות — מתעדכנים כל 3 שניות עד שמחובר.
  useEffect(() => { setPolling(s?.state === 'qr' || s?.state === 'connecting'); }, [s?.state]);

  if (q.isLoading) return <p className="text-sm text-soft">בודקת את שרת הוואטסאפ…</p>;
  if (q.isError) return <p className="text-sm text-bad" role="alert">{humanError(q.error)}</p>;
  if (!s?.configured) {
    return (
      <p className="text-sm text-soft">
        שרת הוואטסאפ עוד לא הוקם. אחרי הקמת השרת הוא יתחבר לכאן לבד, ותופיע כאן אפשרות לסרוק QR.
      </p>
    );
  }
  if (!s.ok) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-bad" role="alert">{s.error ?? 'השרת לא עונה'}</p>
        <button type="button" className="btn-ghost text-xs" onClick={() => void q.refetch()}>בדיקה חוזרת</button>
      </div>
    );
  }
  return (
    <div className="space-y-3 text-sm">
      {s.state === 'connected' ? (
        <p className="text-ok">מחובר{s.me?.phone ? ` · ${s.me.phone}` : ''}{s.me?.name ? ` (${s.me.name})` : ''}</p>
      ) : s.state === 'qr' && s.qrDataUrl ? (
        <div className="space-y-2">
          <p>בטלפון של החוג: <b>וואטסאפ ← הגדרות ← מכשירים מקושרים ← קישור מכשיר</b>, וסורקים:</p>
          <img src={s.qrDataUrl} alt="קוד QR לחיבור וואטסאפ" className="mx-auto h-64 w-64 rounded-field bg-white p-2" />
          <p className="text-xs text-soft">הקוד מתחדש לבד. אחרי הסריקה המסך יתעדכן תוך כמה שניות.</p>
        </div>
      ) : s.state === 'connecting' ? (
        <p className="text-soft">מתחבר…</p>
      ) : (
        <p className="text-soft">{s.state === 'logged_out' ? 'הקישור נותק מהטלפון. צריך לסרוק QR מחדש.' : 'לא מחובר.'}</p>
      )}
      <div className="flex gap-2">
        {s.state !== 'connected' && s.state !== 'qr' && (
          <button type="button" className="btn-primary text-xs" disabled={act.isPending} onClick={() => { act.mutate('connect'); setPolling(true); }}>
            {act.isPending ? 'מכינה QR…' : 'חיבור מספר (QR)'}
          </button>
        )}
        {s.state === 'connected' && (
          <button type="button" className="btn-ghost text-xs text-bad" disabled={act.isPending}
            onClick={() => { if (window.confirm('לנתק את מספר הוואטסאפ מהמערכת? הודעות לא יישלחו עד חיבור מחדש.')) act.mutate('disconnect'); }}>
            ניתוק המספר
          </button>
        )}
      </div>
      {act.error != null && <p className="text-xs text-bad" role="alert">{humanError(act.error)}</p>}
      <p className="text-xs text-soft" dir="ltr">{s.server}</p>
    </div>
  );
}
