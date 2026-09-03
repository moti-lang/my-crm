import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function usePnlMonthly(seasonId: string | null | undefined) {
  return useQuery({
    queryKey: ['pnl-monthly', seasonId ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('v_pnl_monthly').select('*').order('month');
      if (seasonId) q = q.eq('season_id', seasonId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useBranchProfitability() {
  return useQuery({
    queryKey: ['branch-profitability'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_branch_profitability').select('*').order('name');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useLeadFunnel() {
  return useQuery({
    queryKey: ['lead-funnel'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_lead_funnel').select('*').order('month');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}
