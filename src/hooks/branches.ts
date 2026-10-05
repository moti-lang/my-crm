import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Database, Tables } from '@/lib/database.types';

export type Branch = Tables<'branches'>;
export type BranchInput = Pick<Database['public']['Tables']['branches']['Update'],
  'name' | 'city' | 'address' | 'supervisor_name' | 'supervisor_phone' | 'schedule_text' | 'weekdays' | 'lesson_time' |
  'age_groups' | 'capacity' | 'enrollment_open' | 'terms' | 'plan' | 'monthly_rent'>;

/** סניף חדש. התקנון ומבנה התשלום מועתקים במסד מברירת המחדל (טריגר branches_defaults). */
export function useCreateBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BranchInput & { name: string }) => {
      const { data, error } = await supabase.from('branches').insert(input).select('id').single();
      if (error) throw new Error(error.message);
      return data.id;
    },
    onSuccess: () => { void qc.invalidateQueries(); },
  });
}

/** עדכון סניף. מבנה תשלום שלא מסתכם נדחה במסד, וההודעה חוזרת לבעלים. */
export function useUpdateBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: BranchInput & { id: string }) => {
      const { error } = await supabase.from('branches').update(patch).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { void qc.invalidateQueries(); },
  });
}

/** מצב ההרשמה: פתוח / סגור / מלא, וכמה מקומות נתפסו מתוך המכסה. */
export function useBranchEnrollmentState(branchId: string | undefined) {
  return useQuery({
    queryKey: ['branch-enrollment-state', branchId],
    enabled: Boolean(branchId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rpc_branch_enrollment_state', { p_branch: branchId as string });
      if (error) throw new Error(error.message);
      return data as unknown as { open: boolean; reason: 'closed' | 'full' | 'inactive' | null; taken: number; capacity: number | null };
    },
  });
}

export type NewStudent = {
  branch_id: string; first_name: string; last_name: string; grade?: string; school?: string;
  parent_name?: string; parent_phone?: string; email?: string; status: 'active' | 'pending'; notes?: string; mailing_consent?: boolean;
};

/** הוספת תלמידה ידנית: תנאי הסניף נשמרים אצלה במסד, בלי קישור תשלום אוטומטי. */
export function useCreateStudent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewStudent) => {
      const { data, error } = await supabase.rpc('rpc_create_student', { p: input });
      if (error) throw new Error(error.message);
      return (data as { id: string }).id;
    },
    onSuccess: () => { void qc.invalidateQueries(); },
  });
}
