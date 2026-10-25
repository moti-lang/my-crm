import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { STATUS_LABEL, STATUS_TONE, type StudentStatus } from '@/lib/studentStatus';
import { useAuth } from '@/auth/AuthProvider';
import type { Views } from '@/lib/database.types';
import type { StudentExportRow } from '@/lib/studentsExport';

export { STATUS_LABEL, STATUS_TONE, type StudentStatus };

/** רשימת התלמידות. הסינון לפי סניף הוא נוחות בלבד — ההפרדה נאכפת ב-RLS. */
export function useStudents() {
  // ★ רואת חשבון: אין לה הרשאה על students (בגלל הטלפונים), ולכן v_student_overview ריק בשבילה
  //   והמסך היה ריק. היא מקבלת את הרשימה מ-rpc_students_export — אותו מקור כמו הייצוא, בלי פרטי קשר.
  const { profile } = useAuth();
  const accounting = profile?.role === 'accountant';
  return useQuery({
    queryKey: ['students', accounting ? 'accounting' : 'overview'],
    queryFn: async () => {
      if (accounting) {
        const { data, error } = await supabase.rpc('rpc_students_export', {});
        if (error) throw new Error(error.message);
        return (data ?? []) as unknown as Views<'v_student_overview'>[];
      }
      const { data, error } = await supabase
        .from('v_student_overview')
        .select('*')
        .order('full_name');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

/** כל הפרטים לייצוא לאקסל. ההרשאה במסד: מנהלת סניף — הסניף שלה; רואת חשבון — בלי פרטי קשר. */
export async function fetchStudentsExport(branchId?: string | null): Promise<StudentExportRow[]> {
  const { data, error } = await supabase.rpc('rpc_students_export', branchId ? { p_branch: branchId } : {});
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as StudentExportRow[];
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
