import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Enums } from '@/lib/database.types';

/** אחרי כל כתיבה כספית — כל מה שמציג כסף חייב להתרענן. */
const MONEY_KEYS = [
  ['branch-pnl'], ['student-balances'], ['students'], ['debtors'],
  ['ledger'], ['general-allocation'], ['payments'],
];

function useInvalidateMoney() {
  const qc = useQueryClient();
  return async () => {
    await Promise.all(MONEY_KEYS.map((key) => qc.invalidateQueries({ queryKey: key })));
  };
}

// ─────────────────────────────── גבייה ───────────────────────────────

export function useDebtors() {
  return useQuery({
    queryKey: ['debtors'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_debtors').select('*').order('balance', { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useAddPayment() {
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: async (input: {
      student_id: string;
      amount: number;
      paid_on: string;
      method: Enums<'payment_method'>;
      covers_note?: string | null;
      receipt_no?: string | null;
      note?: string | null;
    }) => {
      const { data, error } = await supabase.from('payments').insert(input).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useTemplates() {
  return useQuery({
    queryKey: ['templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('message_templates').select('*').eq('is_active', true).order('name');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

/** יוצר תזכורות מתוזמנות. השליחה בפועל היא של cron-reminders (סבב 5). */
export function useCreateReminders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rows: {
      kind: Enums<'reminder_kind'>;
      student_id: string;
      branch_id: string | null;
      to_phone: string;
      to_label: string;
      body: string;
      scheduled_at: string;
    }[]) => {
      const { data, error } = await supabase.from('reminders').insert(rows).select('id');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['reminders'] });
    },
  });
}

// ─────────────────────────── הוצאות והכנסות ───────────────────────────

export function useLedger(scope?: Enums<'entry_scope'>) {
  return useQuery({
    queryKey: ['ledger', scope ?? 'all'],
    queryFn: async () => {
      let q = supabase
        .from('ledger_entries')
        .select('*, branches(name), productions(name)')
        .is('deleted_at', null)
        .order('entry_date', { ascending: false });
      if (scope) q = q.eq('scope', scope);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useCategories(scope: Enums<'entry_scope'>, kind: Enums<'entry_kind'>) {
  return useQuery({
    queryKey: ['categories', scope, kind],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories').select('*')
        .eq('scope', scope).eq('kind', kind).eq('is_active', true)
        .order('sort_order');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useCurrentSeasonId() {
  return useQuery({
    queryKey: ['current-season-id'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('seasons').select('id').eq('is_current', true).maybeSingle();
      if (error) throw new Error(error.message);
      return data?.id ?? null;
    },
  });
}

export function useAddLedgerEntry() {
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: async (input: {
      season_id: string;
      kind: Enums<'entry_kind'>;
      scope: Enums<'entry_scope'>;
      branch_id?: string | null;
      entry_date: string;
      category: string;
      vendor?: string | null;
      description?: string | null;
      amount: number;
      method?: Enums<'payment_method'> | null;
      is_recurring?: boolean;
      recurring_day?: number | null;
    }) => {
      const { data, error } = await supabase.from('ledger_entries').insert(input).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: invalidate,
  });
}

/** מחיקה רכה — לעולם לא מוחקים רשומה כספית באמת. */
export function useSoftDeleteEntry() {
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('ledger_entries').update({ deleted_at: new Date().toISOString() }).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}

// ─────────────────────────── כספים כלליים ───────────────────────────

export function useGeneralAllocation() {
  return useQuery({
    queryKey: ['general-allocation'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_general_allocation').select('*').order('branch_name');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useUpdateSplitMethod() {
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: async (input: { id: string; split_method: Enums<'split_method'> }) => {
      const { error } = await supabase
        .from('ledger_entries')
        .update({ split_method: input.split_method })
        .eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}
