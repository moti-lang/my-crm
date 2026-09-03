import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Database, Enums, Tables } from '@/lib/database.types';

export type ProductionStatus = Enums<'production_status'>;
export type ProductionPnl = Database['public']['Views']['v_production_pnl']['Row'];

export const PRODUCTION_STATUS_LABEL: Record<ProductionStatus, string> = {
  planning: 'בתכנון',
  rehearsals: 'בחזרות',
  filming: 'בצילומים',
  editing: 'בעריכה',
  released: 'הופץ',
};

const KEYS = [['productions'], ['production'], ['production-ledger'], ['ledger'], ['student-productions'], ['production-cast']];

function useInvalidateProductions() {
  const qc = useQueryClient();
  return async () => {
    await Promise.all(KEYS.map((key) => qc.invalidateQueries({ queryKey: key })));
  };
}

/** כל ההפקות עם תקציב מול ביצוע ורווח — מהתצוגה, לא מחישוב בצד הלקוח. */
export function useProductions() {
  return useQuery({
    queryKey: ['productions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_production_pnl').select('*')
        .order('release_date', { ascending: false, nullsFirst: true })
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useProduction(id: string | undefined) {
  return useQuery({
    queryKey: ['production', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_production_pnl').select('*').eq('production_id', id as string).maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

export function useProductionLedger(id: string | undefined) {
  return useQuery({
    queryKey: ['production-ledger', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ledger_entries').select('*')
        .eq('scope', 'production').eq('production_id', id as string)
        .is('deleted_at', null)
        .order('entry_date', { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export type CastRow = { role_name: string | null; student_id: string; students: { full_name: string; photo_consent: boolean; branches: { name: string } | null } | null };

export function useProductionCast(id: string | undefined) {
  return useQuery({
    queryKey: ['production-cast', id],
    enabled: Boolean(id),
    queryFn: async (): Promise<CastRow[]> => {
      const { data, error } = await supabase
        .from('production_cast')
        .select('role_name, student_id, students(full_name, photo_consent, branches(name))')
        .eq('production_id', id as string);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as CastRow[];
    },
  });
}

export function useAddProduction() {
  const invalidate = useInvalidateProductions();
  return useMutation({
    mutationFn: async (input: { name: string; year: string | null; status: ProductionStatus; budget: number; release_date: string | null; notes: string | null }) => {
      const { data, error } = await supabase.from('productions').insert(input).select('id').single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateProduction() {
  const invalidate = useInvalidateProductions();
  return useMutation({
    mutationFn: async (input: { id: string; patch: Partial<Pick<Tables<'productions'>, 'name' | 'year' | 'status' | 'budget' | 'release_date' | 'notes'>> }) => {
      const { error } = await supabase.from('productions').update(input.patch).eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}

/** מחיקה רכה. ההוצאות וההכנסות נשארות בספר הכספים. */
export function useSoftDeleteProduction() {
  const invalidate = useInvalidateProductions();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('productions').update({ deleted_at: new Date().toISOString() }).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}

/**
 * צירוף משתתפת. המסך חוסם תלמידה בלי אישור צילום, והמסד חוסם שוב
 * (f_guard_photo_consent) — המסך הוא נוחות, הטריגר הוא הכלל.
 */
export function useAddCast() {
  const invalidate = useInvalidateProductions();
  return useMutation({
    mutationFn: async (input: { production_id: string; student_id: string; role_name: string | null }) => {
      const { error } = await supabase.from('production_cast').insert(input);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}

export function useRemoveCast() {
  const invalidate = useInvalidateProductions();
  return useMutation({
    mutationFn: async (input: { production_id: string; student_id: string }) => {
      const { error } = await supabase.from('production_cast').delete()
        .eq('production_id', input.production_id).eq('student_id', input.student_id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}
