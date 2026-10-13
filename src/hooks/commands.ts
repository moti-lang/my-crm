import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Tables } from '@/lib/database.types';
import { normalizePhone } from '@/lib/format';

// מסך "פקודות וואטסאפ" (בעלים בלבד — RLS על שתי הטבלאות הוא owner-only).
export type AuthorizedNumber = Tables<'authorized_numbers'> & { branches: { name: string } | null };
export type CommandRow = Tables<'commands'>;
export type Scope = 'all' | 'finance' | 'branch';

export const SCOPE_LABEL: Record<Scope, string> = {
  all: 'הכול',
  finance: 'כספים בלבד',
  branch: 'סניף אחד',
};
export const SCOPE_HINT: Record<Scope, string> = {
  all: 'כל הפקודות, בכל הסניפים',
  finance: 'הוצאות, הכנסות, תשלומים ושאלות',
  branch: 'רק בסניף שנבחר',
};

export function useAuthorizedNumbers() {
  return useQuery({
    queryKey: ['authorized-numbers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('authorized_numbers').select('*, branches(name)').order('created_at');
      if (error) throw new Error(error.message);
      return (data ?? []) as AuthorizedNumber[];
    },
  });
}

/** הודעת שגיאה מהמסד בשפה של המסך. */
function numberError(e: { message: string; code?: string }): Error {
  if (e.code === '23505') return new Error('המספר הזה כבר ברשימה');
  if (/phone_format/.test(e.message)) return new Error('מספר הטלפון לא תקין');
  if (/branch_check/.test(e.message)) return new Error('במספר של סניף צריך לבחור סניף');
  if (/label_check/.test(e.message)) return new Error('חסר שם');
  return new Error(e.message);
}

export function useSaveAuthorizedNumber() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id?: string; label?: string; phone?: string; scope?: Scope; branch_id?: string | null; can_delete?: boolean; is_active?: boolean }) => {
      const { id, ...row } = input;
      if (row.phone !== undefined) row.phone = normalizePhone(row.phone);
      if (row.scope && row.scope !== 'branch') row.branch_id = null;
      const { error } = id
        ? await supabase.from('authorized_numbers').update(row).eq('id', id)
        : await supabase.from('authorized_numbers').insert({ label: row.label ?? '', phone: row.phone ?? '', scope: row.scope ?? 'all',
            branch_id: row.branch_id ?? null, can_delete: row.can_delete ?? false });
      if (error) throw numberError(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['authorized-numbers'] }),
  });
}

export function useCommands() {
  return useQuery({
    queryKey: ['commands'],
    queryFn: async () => {
      const { data, error } = await supabase.from('commands').select('*').order('created_at', { ascending: false }).limit(200);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

/** ביטול פעולה מ-24 השעות האחרונות — אותו היפוך כמו "בטל" בוואטסאפ (rpc_cancel_command). */
export function useCancelCommand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc('rpc_owner_cancel_command', { p_command_id: id });
      if (error) throw new Error(error.message);
      const r = (data ?? {}) as { ok?: boolean; reason?: string; message?: string };
      if (!r.ok) throw new Error(r.message ?? (r.reason === 'not_applied' ? 'הפעולה כבר אינה פעילה' : 'הביטול לא הצליח'));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['commands'] }),
  });
}

// ─────────── צ'אט הבדיקה: המנוע האמיתי (wa-command-test → routeIncoming) ───────────
export type TestChatResult =
  | { ok: true; route: string; reply: string | null; commandId: string | null;
      parse: ({ ok: true; dryRun: boolean; intent: string; confidence: number; fields: Record<string, unknown>; missing: string[]; human_summary: string }
        | { ok: false; dryRun: boolean; reason: string; detail: string }) | null;
      authorized: { allowed: boolean; reason?: string } | null; result: Record<string, unknown> | null }
  | { ok: false; error: string };

export async function sendTestCommand(phone: string, text: string): Promise<TestChatResult> {
  const { data, error } = await supabase.functions.invoke('wa-command-test', { body: { phone, text } });
  if (error) {
    // תשובת 400 מהפונקציה נושאת הסבר — מציגים אותו ולא "שגיאת שרת".
    const ctx = (error as { context?: Response }).context;
    const body = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
    return { ok: false, error: (body as { error?: string } | null)?.error ?? error.message };
  }
  return data as TestChatResult;
}
