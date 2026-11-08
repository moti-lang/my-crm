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
export const EVENT_LABEL: Record<string, string> = { reschedule: 'שינוי יום חיוב', sumit_change: 'שונה ב-SUMIT', amount_change: 'שינוי סכום (הנחה)',
  retry_charge: 'חיוב חוזר', retry_declined: 'חיוב חוזר נדחה', renewed: 'הוראה חודשה ב-SUMIT' };
/** "מאיזה לאיזה" ביומן: תאריכים — או סכומים בשינוי סכום; בחיוב חוזר — איזה חיוב ומה קרה. */
export function eventChange(e: { kind: string | null; from_date: string | null; to_date: string | null; from_amount?: number | null; to_amount?: number | null;
                                 remaining?: number | null; note?: string | null },
                            fmtDate: (d: string | null) => string, fmtMoney: (n: number | null | undefined) => string): [string, string] {
  if (e.kind === 'amount_change') return [fmtMoney(e.from_amount), fmtMoney(e.to_amount)];
  if (e.kind === 'retry_charge') return [`${fmtDate(e.from_date)} (נכשל)`, `${fmtMoney(e.to_amount)} — עבר`];
  if (e.kind === 'retry_declined') return [`${fmtDate(e.from_date)} (נכשל)`, `נדחה${e.note ? `: ${e.note}` : ''}`];
  if (e.kind === 'renewed') return ['הוראה שהושבתה', `${fmtDate(e.to_date)} · ${e.remaining ?? '—'} חיובים`];
  return [fmtDate(e.from_date), fmtDate(e.to_date)];
}

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

// ─────────── ניסיון חיוב חוזר (הוראה שהושבתה אחרי חיוב שנכשל) ───────────
/** התוכנית — מהמסד, לפני הלחיצה. stage: 'charge' (חיוב ואז חידוש) / 'renew' (החיוב כבר עבר — רק חידוש). */
export type RetryPlan =
  | { ok: true; stage: 'charge' | 'renew'; amount: number; missed: string | null; remaining_after: number; next: string | null;
      final: string | null; day: number; lines: string[] }
  | { ok: false; error: string };

export function useRetryPreview(orderId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['standing-retry-preview', orderId],
    enabled: Boolean(orderId && enabled),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rpc_standing_retry_preview', { p_id: orderId as string });
      if (error) throw new Error(error.message);
      return data as unknown as RetryPlan;
    },
  });
}

export type RetryResult = { charged: number; renewed: boolean; completed: boolean; next: string | null; remaining: number };
export class RetryChanged extends Error {
  constructor(message: string, readonly plan: RetryPlan) { super(message); }
}

/**
 * הלחיצה: חיוב על הכרטיס השמור ב-SUMIT ואז הוראה חדשה (או רק חידוש). stage ו-next — מה שהבעלים ראתה;
 * אם המצב השתנה, לא נוגעים וחוזרת התוכנית החדשה (RetryChanged).
 */
export function useRetryStanding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; stage: 'charge' | 'renew'; next: string | null }) => {
      const { data, error } = await supabase.functions.invoke('standing-order-retry', { body: input });
      let r = data as ({ ok?: boolean; error?: string; changed?: boolean; plan?: RetryPlan } & Partial<RetryResult>) | null;
      if (error && 'context' in error) {
        try { r = (await (error as { context: Response }).context.json()) as typeof r; } catch { /* ignore */ }
      }
      if (!r?.ok) {
        if (r?.changed && r.plan) throw new RetryChanged(r.error ?? 'המצב השתנה', r.plan);
        throw new Error(r?.error ?? error?.message ?? 'החיוב החוזר נכשל');
      }
      return r as RetryResult;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['standing-orders'] });
      void qc.invalidateQueries({ queryKey: ['standing-events'] });
      void qc.invalidateQueries({ queryKey: ['standing-retry-preview'] });
      void qc.invalidateQueries({ queryKey: ['students'] });
      void qc.invalidateQueries({ queryKey: ['payments'] });
    },
  });
}
