import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { PlanInput, Track, EnrollQuestions } from '@/lib/enrollment';

/** מבנה התשלום, מההגדרות. הקוד לא מכיר סכומים. */
export type EnrollmentPlan = {
  annual_total: number; registration_fee: number; registration_fee_purpose: string;
  installments: number; installment_amount: number; first_charge: number; tuition: number;
  trial_days: number; cancel_refund: number;
};
export type EnrollmentPublic =
  | { ok: true; program_name: string | null; terms: string; plan: EnrollmentPlan | null; open: boolean; closed_reason: 'closed' | 'full' | 'inactive' | null;
      /** false = התשלום נגבה מחוץ למערכת (מתנ"ס וכד'): בלי שאלת תשלום ובלי סכומים. */
      collect_payments: boolean; whatsapp_group_url: string | null;
      branch: { name: string; city: string | null; schedule: string | null; age_groups: string | null };
      /** המסלולים שההורה רואה (הוראות קבע מוסתרות עד שיופעלו). */
      tracks: Track[]; questions: EnrollQuestions; photo_consent_text: string | null }
  | { ok: false; error: string };

/** הדף הציבורי: הסניף של הקישור — שם, תקנון, מבנה. anon. */
export function useEnrollmentPublic(token: string) {
  return useQuery({
    queryKey: ['enrollment-public', token],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rpc_enrollment_public', { p_token: token });
      if (error) throw new Error(error.message);
      return data as unknown as EnrollmentPublic;
    },
  });
}

export type EnrollInput = {
  first_name: string; last_name: string; grade: string; school: string; phone: string; email: string;
  enroll_token: string; mailing_consent: boolean; terms_accepted: boolean;
  whatsapp: '' | 'yes' | 'no'; photo: '' | 'yes' | 'no'; track: string;
};
export type EnrollResult =
  | { ok: true; pay_url: string | null; amount: number | null; method: Track['method'] | 'external'; track: string | null; student: string; branch: string;
      program_name: string | null; whatsapp_group_url: string | null }
  | { ok: false; error: string };

export async function enroll(input: EnrollInput): Promise<EnrollResult> {
  // דרך ה-Edge Function `enroll`, לא RPC ישיר: רק היא רואה את ה-IP, וההגבלה
  // לפי IP חלה במסד. ה-RPC עצמה סגורה ל-anon (0024).
  const { data, error } = await supabase.functions.invoke('enroll', { body: input });
  if (error) throw new Error(error.message);
  return data as EnrollResult;
}

// ─────────── הבעלים ───────────
export function useEnrolledUnpaid() {
  return useQuery({
    queryKey: ['enrolled-unpaid'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_enrolled_unpaid').select('*').order('enrolled_at');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useMailingList() {
  return useQuery({
    queryKey: ['mailing-list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_mailing_list').select('*').order('full_name');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export type InstallmentProgress = {
  registration_fee: number; registration_paid: number; tuition: number; tuition_paid: number;
  installments_total: number | null; installment_amount: number | null; installments_paid: number | null; balance: number;
};
export function useInstallmentProgress(studentId: string | null) {
  return useQuery({
    queryKey: ['installments', studentId],
    enabled: Boolean(studentId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rpc_installment_progress', { p_student: studentId as string });
      if (error) throw new Error(error.message);
      return data as unknown as InstallmentProgress | null;
    },
  });
}

export function useCancelEnrollment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (studentId: string) => {
      const { data, error } = await supabase.rpc('rpc_cancel_enrollment', { p_student: studentId });
      if (error) throw new Error(error.message);
      return data as unknown as { ok: boolean; refund: number; paid_before: number };
    },
    onSuccess: () => { void qc.invalidateQueries(); },
  });
}

// ─────────── הגדרות ההרשמה (הבעלים עורכת, בלי קוד) ───────────
export function useEnrollmentSettings() {
  return useQuery({
    queryKey: ['enrollment-settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('settings').select('key, value').in('key', ['program_name', 'enrollment_terms', 'enrollment_plan', 'app_base_url', 'photo_consent_text']);
      if (error) throw new Error(error.message);
      const by = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
      return {
        program_name: String(by.program_name ?? ''),
        terms: String(by.enrollment_terms ?? ''),
        plan: (by.enrollment_plan ?? {}) as PlanInput,
        photo_consent_text: String(by.photo_consent_text ?? ''),
        base_url: String(by.app_base_url ?? ''),
      };
    },
  });
}

export function useSaveEnrollmentSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { program_name: string; terms: string; plan: PlanInput; photo_consent_text: string }) => {
      const rows = [
        { key: 'program_name', value: input.program_name },
        { key: 'enrollment_terms', value: input.terms },
        { key: 'enrollment_plan', value: input.plan },
        { key: 'photo_consent_text', value: input.photo_consent_text },
      ];
      const { error } = await supabase.from('settings').upsert(rows, { onConflict: 'key' });
      if (error) throw new Error(error.message);
      // המסד מאמת שהמבנה מסתכם; אם לא — ההרשמה תסרב. בודקים מיד ומחזירים את השגיאה לבעלים.
      const { error: planErr } = await supabase.rpc('rpc_enrollment_plan');
      if (planErr) throw new Error(planErr.message);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['enrollment-settings'] }); void qc.invalidateQueries({ queryKey: ['enrollment-public'] }); },
  });
}
