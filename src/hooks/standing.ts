import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Views } from '@/lib/database.types';

export type StandingOrder = Views<'v_standing_orders'>;

export const STANDING_LABEL: Record<string, string> = {
  active: 'פעילה', retrying: 'חיוב נדחה — ניסיון חוזר', failed: 'הושבתה אחרי כישלון',
  setup_failed: 'לא נוצרה ב-SUMIT', cancelled: 'נעצרה', completed: 'הסתיימה',
};
export const STANDING_TONE: Record<string, string> = {
  active: 'bg-ok/15 text-ok', retrying: 'bg-bad/15 text-bad', failed: 'bg-bad/15 text-bad',
  setup_failed: 'bg-bad/15 text-bad', cancelled: 'bg-shade text-soft', completed: 'bg-shade text-soft',
};

export function useStandingOrders() {
  return useQuery({
    queryKey: ['standing-orders'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_standing_orders').select('*')
        .order('needs_attention', { ascending: false }).order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

/**
 * עצירה: הפונקציה מבטלת ב-SUMIT קודם, ורק אחר כך מסמנת אצלנו.
 * שגיאה מ-SUMIT חוזרת כמו שהיא — ההוראה נשארת פעילה.
 */
export function useCancelStanding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke('standing-order-cancel', { body: { id } });
      const r = data as { ok?: boolean; error?: string } | null;
      if (error || !r?.ok) {
        let msg = r?.error;
        if (!msg && error && 'context' in error) {
          try { msg = ((await (error as { context: Response }).context.json()) as { error?: string }).error; } catch { /* ignore */ }
        }
        throw new Error(msg ?? error?.message ?? 'העצירה נכשלה');
      }
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['standing-orders'] }); },
  });
}

export type StandingEvent = Views<'v_standing_order_events'>;
export const EVENT_LABEL: Record<string, string> = { reschedule: 'שינוי יום חיוב', sumit_change: 'שונה ב-SUMIT' };

/** יומן הוראות הקבע: מי שינה, מתי, מאיזה תאריך לאיזה. orderId — של הוראה אחת. */
export function useStandingEvents(orderId?: string | null) {
  return useQuery({
    queryKey: ['standing-events', orderId ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('v_standing_order_events').select('*').order('created_at', { ascending: false }).limit(200);
      if (orderId) q = q.eq('standing_order_id', orderId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

/** התוכנית של "שינוי יום חיוב" — מהמסד, לפני שמירה. אותה תוכנית שהפונקציה בודקת. */
export type ReschedulePlan =
  | { ok: true; next: string; final: string; remaining: number; day: number; from: string; from_day: number;
      kind: 'charged_this_month' | 'day_ahead' | 'day_passed'; current: string; reason: string; sentence: string }
  | { ok: false; error: string };

export function useReschedulePreview(orderId: string | null, day: number | null) {
  return useQuery({
    queryKey: ['standing-reschedule-preview', orderId, day],
    enabled: Boolean(orderId && day),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rpc_standing_reschedule_preview', { p_id: orderId as string, p_day: day as number });
      if (error) throw new Error(error.message);
      return data as unknown as ReschedulePlan;
    },
  });
}

export class RescheduleChanged extends Error {
  constructor(message: string, readonly plan: ReschedulePlan) { super(message); }
}

/**
 * השמירה: ב-SUMIT קודם, ורק אם SUMIT אישרה — אצלנו. expected = התאריך שהבעלים ראתה;
 * אם המצב השתנה בינתיים, הפונקציה לא משנה ומחזירה את התוכנית החדשה (RescheduleChanged).
 */
export function useRescheduleStanding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; day: number; expected: string }) => {
      const { data, error } = await supabase.functions.invoke('standing-order-reschedule', { body: input });
      let r = data as { ok?: boolean; error?: string; changed?: boolean; plan?: ReschedulePlan } | null;
      if (error && 'context' in error) {
        try { r = (await (error as { context: Response }).context.json()) as typeof r; } catch { /* ignore */ }
      }
      if (!r?.ok) {
        if (r?.changed && r.plan) throw new RescheduleChanged(r.error ?? 'המצב השתנה', r.plan);
        throw new Error(r?.error ?? error?.message ?? 'השינוי נכשל');
      }
      return r.plan as Extract<ReschedulePlan, { ok: true }>;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['standing-orders'] });
      void qc.invalidateQueries({ queryKey: ['standing-events'] });
      void qc.invalidateQueries({ queryKey: ['standing-reschedule-preview'] });
    },
  });
}
