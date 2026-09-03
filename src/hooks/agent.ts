import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Tables } from '@/lib/database.types';

export type Faq = Tables<'faq_entries'>;
export type Conversation = Tables<'conversations'> & { students: { full_name: string; status: string } | null };
export type Unanswered = Tables<'unanswered_questions'>;
export type WaMessage = Tables<'wa_messages'>;

function useInvalidate(keys: string[][]) {
  const qc = useQueryClient();
  return async () => { await Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k }))); };
}

// ─────────── מאגר שאלות ───────────
export function useFaq() {
  return useQuery({
    queryKey: ['faq'],
    queryFn: async () => {
      const { data, error } = await supabase.from('faq_entries').select('*').order('hits', { ascending: false }).order('created_at');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useSaveFaq() {
  const invalidate = useInvalidate([['faq'], ['unanswered']]);
  return useMutation({
    mutationFn: async (input: { id?: string; question: string; answer: string; keywords: string[]; is_active: boolean; resolveUnansweredId?: string }) => {
      const row = { question: input.question.trim(), answer: input.answer.trim(), keywords: input.keywords, is_active: input.is_active };
      let id = input.id;
      if (id) {
        const { error } = await supabase.from('faq_entries').update(row).eq('id', id);
        if (error) throw new Error(error.message);
      } else {
        const { data, error } = await supabase.from('faq_entries').insert(row).select('id').single();
        if (error) throw new Error(error.message);
        id = data.id;
      }
      if (input.resolveUnansweredId) {
        const { error } = await supabase.from('unanswered_questions').update({ resolved: true, faq_id: id }).eq('id', input.resolveUnansweredId);
        if (error) throw new Error(error.message);
      }
      return id;
    },
    onSuccess: invalidate,
  });
}

// ─────────── שאלות ללא מענה ───────────
export function useUnanswered() {
  return useQuery({
    queryKey: ['unanswered'],
    queryFn: async () => {
      const { data, error } = await supabase.from('unanswered_questions').select('*').order('resolved').order('created_at', { ascending: false }).limit(200);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useResolveUnanswered() {
  const invalidate = useInvalidate([['unanswered']]);
  return useMutation({
    mutationFn: async (input: { id: string; resolved: boolean }) => {
      const { error } = await supabase.from('unanswered_questions').update({ resolved: input.resolved }).eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}

// ─────────── שיחות ───────────
export function useConversations() {
  return useQuery({
    queryKey: ['conversations'],
    queryFn: async (): Promise<Conversation[]> => {
      const { data, error } = await supabase.from('conversations').select('*, students(full_name, status)')
        .order('last_message_at', { ascending: false, nullsFirst: false }).limit(200);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Conversation[];
    },
  });
}

export function useConversationMessages(phone: string | null) {
  return useQuery({
    queryKey: ['conversation-messages', phone],
    enabled: Boolean(phone),
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('wa_messages').select('*').eq('phone', phone as string)
        .order('created_at', { ascending: true }).limit(300);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useSetTakeover() {
  const invalidate = useInvalidate([['conversations']]);
  return useMutation({
    mutationFn: async (input: { phone: string; takeover: boolean }) => {
      const { error } = await supabase.from('conversations').update({ is_human_takeover: input.takeover }).eq('phone', input.phone);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}

// ─────────── הגדרת המחירים ───────────
export function useMayQuotePrices() {
  return useQuery({
    queryKey: ['setting', 'agent_may_quote_prices'],
    queryFn: async () => {
      const { data, error } = await supabase.from('settings').select('value').eq('key', 'agent_may_quote_prices').maybeSingle();
      if (error) throw new Error(error.message);
      return data?.value === true || data?.value === 'true';
    },
  });
}

export function useSetMayQuotePrices() {
  const invalidate = useInvalidate([['setting', 'agent_may_quote_prices']]);
  return useMutation({
    mutationFn: async (value: boolean) => {
      const { error } = await supabase.from('settings').upsert({ key: 'agent_may_quote_prices', value }, { onConflict: 'key' });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}

// ─────────── הסימולטור: ai-answer האמיתי, בלי לכתוב דבר ───────────
export type SimTurn = { role: 'user' | 'assistant'; text: string; kind?: string; dryRun?: boolean; faq?: string | null; error?: string };

export type AnswerOutcome =
  | { ok: true; dryRun: boolean; answer: { kind: string; reply: string; faq_question: string | null; lead: Record<string, string | null> | null; lead_complete: boolean; confidence: number } }
  | { ok: false; dryRun: boolean; reason: string; detail: string };

export async function simulateAnswer(input: {
  text: string; history: { role: 'user' | 'assistant'; text: string }[];
  faq: { question: string; answer: string }[]; branches: string[]; mayQuotePrices: boolean; lead: Record<string, string | null> | null;
}): Promise<AnswerOutcome> {
  const { data, error } = await supabase.functions.invoke('ai-answer', { body: input });
  if (error) throw new Error(error.message);
  return data as AnswerOutcome;
}
