import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Enums, Tables } from '@/lib/database.types';

export type AllowedUser = Tables<'allowed_users'> & { branches: { name: string } | null };
export type UserRole = Enums<'user_role'>;

/** רשימת המורשים. RLS: הבעלים רואה הכל, כל אחת אחרת רק את עצמה. */
export function useAllowedUsers() {
  return useQuery({
    queryKey: ['allowed-users'],
    queryFn: async (): Promise<AllowedUser[]> => {
      const { data, error } = await supabase
        .from('allowed_users')
        .select('*, branches(name)')
        .order('invited_at', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as AllowedUser[];
    },
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return async () => {
    await qc.invalidateQueries({ queryKey: ['allowed-users'] });
  };
}

export function useInviteUser() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: { email: string; full_name: string; role: UserRole; branch_id: string | null; invited_by: string }) => {
      const { error } = await supabase.from('allowed_users').insert({
        email: input.email.trim().toLowerCase(),
        full_name: input.full_name.trim(),
        role: input.role,
        branch_id: input.role === 'branch_manager' ? input.branch_id : null,
        invited_by: input.invited_by,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}

export function useUpdateAllowedUser() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: { id: string; patch: Partial<Pick<Tables<'allowed_users'>, 'role' | 'branch_id' | 'is_active' | 'full_name'>> }) => {
      const { error } = await supabase.from('allowed_users').update(input.patch).eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}

export function useRemoveAllowedUser() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('allowed_users').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}

/**
 * הודעות הטריגרים מגיעות עם קידומת ALLOWLIST: ובעברית — הן נועדו למסך.
 * כל שגיאה אחרת מתורגמת כרגיל.
 */
export function allowlistError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const m = raw.match(/ALLOWLIST:\s*(.+)/);
  if (m) return (m[1] ?? '').trim();
  if (/duplicate key|already exists/i.test(raw)) return 'האימייל הזה כבר ברשימה.';
  if (/check constraint/i.test(raw)) return 'האימייל אינו תקין.';
  if (/row-level security|permission denied/i.test(raw)) return 'רק הבעלים יכולה לנהל את רשימת המורשים.';
  return 'הפעולה נכשלה. נסי שוב.';
}
