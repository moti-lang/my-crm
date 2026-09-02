import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function useLessonSummary() {
  return useQuery({
    queryKey: ['lesson-summary'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_lesson_summary').select('*')
        .order('lesson_date', { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useAttendanceLinks() {
  return useQuery({
    queryKey: ['attendance-links'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('attendance_links').select('*').eq('is_active', true);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useIssueLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (branchId: string) => {
      const { data, error } = await supabase.rpc('rpc_issue_attendance_link', { p_branch: branchId });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['attendance-links'] }); },
  });
}

export function useRevokeLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (branchId: string) => {
      const { error } = await supabase.rpc('rpc_revoke_attendance_link', { p_branch: branchId });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['attendance-links'] }); },
  });
}
