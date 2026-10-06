import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

/**
 * המסלול שבחרה, "לא מקבלת וואטסאפ" ואישור הצילום, לכל תלמידה. רואת חשבון
 * אינה קוראת מ-students — מקבלת רשימה ריקה, והתגיות פשוט לא מוצגות.
 */
export type StudentFlags = { id: string; payment_track: { key?: string; label?: string; method?: string; installments?: number } | null;
  whatsapp_opt_in: boolean | null; photo_consent_text: string | null; terms_text: string | null; external_payment: boolean };
export function useStudentFlags() {
  return useQuery({
    queryKey: ['student-flags'],
    queryFn: async () => {
      const { data, error } = await supabase.from('students').select('id, payment_track, whatsapp_opt_in, photo_consent_text, terms_text, external_payment').is('deleted_at', null);
      if (error) return new Map<string, StudentFlags>();
      return new Map((data ?? []).map((r) => [r.id, r as unknown as StudentFlags]));
    },
  });
}

// ─────────── מחיקה (רכה), שחזור ומחיקה סופית — בעלים בלבד ───────────
// ★ התשלומים לא נמחקים ולא יוצאים מהדוחות. רק הכרטיס מוסתר.
export type DeletedStudent = { id: string; full_name: string; branch_name: string; parent_phone: string | null; deleted_at: string; paid: number; purge_blockers: string[] };

export function useDeletedStudents(enabled: boolean) {
  return useQuery({
    queryKey: ['students', 'deleted'],
    enabled,
    queryFn: async (): Promise<DeletedStudent[]> => {
      const { data, error } = await supabase.rpc('rpc_deleted_students');
      if (error) throw new Error(error.message);
      return (data ?? []) as DeletedStudent[];
    },
  });
}

function useStudentRpc(fn: 'rpc_delete_student' | 'rpc_restore_student' | 'rpc_purge_student') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (studentId: string) => {
      const { data, error } = await supabase.rpc(fn, { p_student: studentId });
      if (error) throw new Error(error.message);
      return data as { ok: boolean; links_cancelled?: number; reminders_cancelled?: number };
    },
    // כרטיס, רשימות, יתרות וחוב פתוח — הכל נטען מחדש.
    onSuccess: () => qc.invalidateQueries(),
  });
}
export const useDeleteStudent = () => useStudentRpc('rpc_delete_student');
export const useRestoreStudent = () => useStudentRpc('rpc_restore_student');
export const usePurgeStudent = () => useStudentRpc('rpc_purge_student');
