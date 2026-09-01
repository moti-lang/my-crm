import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/** כל קריאת רשת עוברת דרך React Query עם מצבי טעינה ושגיאה. */

export function useBranchPnl() {
  return useQuery({
    queryKey: ['branch-pnl'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_branch_pnl').select('*').order('name');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useBranches() {
  return useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('branches')
        .select('*')
        .is('deleted_at', null)
        .order('name');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useStudentBalances() {
  return useQuery({
    queryKey: ['student-balances'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_student_balance').select('*');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

/** שיעורים של היום שטרם דווחה בהם נוכחות — מזין את הבאנר האדום בדשבורד. */
export function useUnreportedToday() {
  return useQuery({
    queryKey: ['unreported-today'],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('lessons')
        .select('id, branch_id, lesson_date, branches(name)')
        .eq('lesson_date', today)
        .eq('status', 'pending');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useCurrentSeason() {
  return useQuery({
    queryKey: ['current-season'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('seasons')
        .select('*')
        .eq('is_current', true)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });
}
