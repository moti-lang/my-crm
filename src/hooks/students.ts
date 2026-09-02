import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Enums } from '@/lib/database.types';

export type StudentStatus = Enums<'student_status'>;

export const STATUS_LABEL: Record<StudentStatus, string> = {
  active: 'פעילה',
  pending: 'ממתינה',
  stopped: 'הפסיקה',
  graduated: 'סיימה',
};

export const STATUS_TONE: Record<StudentStatus, string> = {
  active: 'bg-ok/15 text-ok',
  pending: 'bg-warn/15 text-warn',
  stopped: 'bg-bad/15 text-bad',
  graduated: 'bg-shade text-soft',
};

/** רשימת התלמידות. הסינון לפי סניף הוא נוחות בלבד — ההפרדה נאכפת ב-RLS. */
export function useStudents() {
  return useQuery({
    queryKey: ['students'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_student_overview')
        .select('*')
        .order('full_name');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useStudentPayments(studentId: string | null) {
  return useQuery({
    queryKey: ['payments', studentId],
    enabled: Boolean(studentId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('student_id', studentId as string)
        .is('deleted_at', null)
        .order('paid_on', { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useStudentProductions(studentId: string | null) {
  return useQuery({
    queryKey: ['student-productions', studentId],
    enabled: Boolean(studentId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_cast')
        .select('role_name, productions(id, name, year, status)')
        .eq('student_id', studentId as string);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useBranch(branchId: string | undefined) {
  return useQuery({
    queryKey: ['branch', branchId],
    enabled: Boolean(branchId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('branches')
        .select('*')
        .eq('id', branchId as string)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });
}
