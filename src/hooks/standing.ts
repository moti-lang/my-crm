import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Views } from '@/lib/database.types';
import type { WhatsappState } from '@/components/LinkResult';

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
  retry_charge: 'חיוב חוזר', retry_declined: 'חיוב חוזר נדחה', renewed: 'הוראה חודשה ב-SUMIT', retry_refused: 'חיוב חוזר לא בוצע', paid_elsewhere: 'שולם בנפרד',
  card_link: 'קישור להחלפת כרטיס', card_replaced: 'כרטיס הוחלף', linked: 'חוברה מ-SUMIT' };
/** "מאיזה לאיזה" ביומן: תאריכים — או סכומים בשינוי סכום; בחיוב חוזר — איזה חיוב ומה קרה. */
export function eventChange(e: { kind: string | null; from_date: string | null; to_date: string | null; from_amount?: number | null; to_amount?: number | null;
                                 remaining?: number | null; note?: string | null },
                            fmtDate: (d: string | null) => string, fmtMoney: (n: number | null | undefined) => string): [string, string] {
  if (e.kind === 'amount_change') return [fmtMoney(e.from_amount), fmtMoney(e.to_amount)];
  if (e.kind === 'retry_charge') return [`${fmtDate(e.from_date)} (נכשל)`, `${fmtMoney(e.to_amount)} — עבר`];
  if (e.kind === 'retry_declined') return [`${fmtDate(e.from_date)} (נכשל)`, `נדחה${e.note ? `: ${e.note}` : ''}`];
  if (e.kind === 'renewed') return ['הוראה שהושבתה', `${fmtDate(e.to_date)} · ${e.remaining ?? '—'} חיובים`];
  if (e.kind === 'retry_refused') return [`${fmtDate(e.from_date)} (נכשל)`, e.note ?? 'לא חויב'];
  if (e.kind === 'card_link') return [`${fmtDate(e.from_date)} (נכשל)`, `נשלח להורה קישור על ${fmtMoney(e.to_amount)} — אחריו עוד ${e.remaining ?? '—'} חיובים`];
  if (e.kind === 'card_replaced') return ['כרטיס חדש', e.note ?? 'הוחלף'];
  if (e.kind === 'linked') return ['הוראה מ-SUMIT', e.note ?? 'חוברה'];
  if (e.kind === 'paid_elsewhere') return [`${fmtDate(e.from_date)} (נכשל)`, `${fmtMoney(e.to_amount)} — שולם בנפרד${e.note ? `: ${e.note}` : ''}`];
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

/** ★ הניסיון האחרון לחיוב חוזר בהוראה (מהיומן): מתי ומה יצא — "איך אני יודעת אם עבר?" (19/11). */
export const RETRY_KINDS = ['retry_charge', 'retry_declined', 'retry_refused'] as const;
export function lastRetryText(events: { kind: string | null; created_at: string | null; to_amount?: number | null; note?: string | null }[],
                              fmtDateTime: (d: string) => string, fmtMoney: (n: number | null | undefined) => string): { text: string; tone: 'ok' | 'bad' | 'warn' } | null {
  const e = events.filter((x) => (RETRY_KINDS as readonly string[]).includes(x.kind ?? '') && x.created_at)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  if (!e) return null;
  const when = fmtDateTime(e.created_at as string);
  if (e.kind === 'retry_charge') return { text: `ניסיון חיוב חוזר אחרון (${when}): ✓ עבר — ${fmtMoney(e.to_amount)}`, tone: 'ok' };
  if (e.kind === 'retry_declined') return { text: `ניסיון חיוב חוזר אחרון (${when}): ✗ נדחה${e.note ? ` — ${e.note}` : ''}`, tone: 'bad' };
  return { text: `ניסיון חיוב חוזר אחרון (${when}): לא בוצע — ${e.note ?? 'לא חויב'}`, tone: 'warn' };
}

/**
 * ★ 0061 (שלוש אחיות, 22/11): החיוב שנכשל שולם בנפרד (חיוב ידני ב-SUMIT) — רושמים אותו בלי לחייב.
 * אחריו ההוראה "צריך לחדש", ו"ניסיון חיוב חוזר" מציע רק חידוש ב-SUMIT, בלי חיוב.
 */
export function usePaidElsewhere() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; paidOn: string; note: string }) => {
      const { data, error } = await supabase.rpc('rpc_standing_paid_elsewhere', { p_id: input.id, p_paid_on: input.paidOn, p_note: input.note });
      if (error) throw new Error(error.message);
      return data as unknown as { amount: number; remaining: number; needs_renewal: boolean };
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

/**
 * ★ "קישור להחלפת כרטיס" (0062): הכרטיס השמור לא עובר. ההורה משלמת בקישור את החיוב שנכשל בכרטיס חדש,
 * ומאשרת בדף את המשך הוראת הקבע עליו. ההוראה הישנה נסגרת כשההורה משלמת; החדשה נוצרת בסנכרון.
 */
export function useStandingCardLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc('rpc_standing_card_link', { p_id: id });
      if (error) throw new Error(error.message);
      return data as unknown as { url: string; amount: number; remaining_after: number; whatsapp: WhatsappState | null };
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['standing-orders'] });
      void qc.invalidateQueries({ queryKey: ['standing-events'] });
      void qc.invalidateQueries({ queryKey: ['payment-links'] });
    },
  });
}

/**
 * ★ "חיבור הוראת קבע מ-SUMIT" (0066): הוראה שנפתחה ידנית ב-SUMIT — מחוברים אותה לתלמידה, ומשם
 * הסנכרון רושם את החיובים ומתריע על כישלון. list — ההוראות של הלקוח; link — החיבור עצמו.
 */
export type SumitLinkItem = {
  id: number; status: number | null; statusLabel: string; amount: number | null;
  next: string | null; prev: string | null; last: string | null; remaining: number | null; linkable: boolean; reason: string | null;
};
async function callLink(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('standing-order-link', { body });
  let r = data as { ok?: boolean; error?: string } | null;
  if (error && 'context' in error) {
    try { r = (await (error as { context: Response }).context.json()) as typeof r; } catch { /* ignore */ }
  }
  if (!r?.ok) throw new Error(r?.error ?? error?.message ?? 'הפעולה נכשלה');
  return r as Record<string, unknown>;
}
export function useSumitLinkList() {
  return useMutation({
    mutationFn: async (input: { student: string; customerId: number }) =>
      (await callLink({ action: 'list', student: input.student, customer_id: input.customerId })).items as SumitLinkItem[],
  });
}
export function useSumitLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { student: string; customerId: number; recurringId: number; total: number }) =>
      (await callLink({ action: 'link', student: input.student, customer_id: input.customerId, recurring_id: input.recurringId, total: input.total })) as
        { done: number; total: number; left: number; next: string | null },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['standing-orders'] });
      void qc.invalidateQueries({ queryKey: ['standing-events'] });
    },
  });
}
