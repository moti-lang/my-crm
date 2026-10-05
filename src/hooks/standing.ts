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
