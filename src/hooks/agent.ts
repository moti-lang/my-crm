import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Tables } from '@/lib/database.types';

export type Faq = Tables<'faq_entries'>;
export type KnowledgeSection = Tables<'knowledge_sections'>;
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

// ─────────── מידע על החוג ───────────
export function useKnowledge() {
  return useQuery({
    queryKey: ['knowledge'],
    queryFn: async () => {
      const { data, error } = await supabase.from('knowledge_sections').select('*').order('position').order('created_at');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useSaveKnowledge() {
  const invalidate = useInvalidate([['knowledge']]);
  return useMutation({
    mutationFn: async (input: { id?: string; title: string; body: string; is_active: boolean; position?: number }) => {
      const row = { title: input.title.trim(), body: input.body.trim(), is_active: input.is_active, ...(input.position !== undefined ? { position: input.position } : {}) };
      if (input.id) {
        const { error } = await supabase.from('knowledge_sections').update(row).eq('id', input.id);
        if (error) throw new Error(error.message);
        return input.id;
      }
      const { data, error } = await supabase.from('knowledge_sections').insert(row).select('id').single();
      if (error) throw new Error(error.message);
      return data.id;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteKnowledge() {
  const invalidate = useInvalidate([['knowledge']]);
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('knowledge_sections').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}

/** סידור מחדש: שני קטעים מחליפים מקום. */
export function useSwapKnowledge() {
  const invalidate = useInvalidate([['knowledge']]);
  return useMutation({
    mutationFn: async (input: { a: { id: string; position: number }; b: { id: string; position: number } }) => {
      const r1 = await supabase.from('knowledge_sections').update({ position: input.b.position }).eq('id', input.a.id);
      if (r1.error) throw new Error(r1.error.message);
      const r2 = await supabase.from('knowledge_sections').update({ position: input.a.position }).eq('id', input.b.id);
      if (r2.error) throw new Error(r2.error.message);
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
export type SimSource = 'faq' | 'knowledge' | null;
export type SimTurn = {
  role: 'user' | 'assistant'; text: string; kind?: string; dryRun?: boolean; error?: string;
  /** מאיפה התשובה שיוצאת בפועל, אחרי השומרים */
  source?: SimSource; faq?: string | null; knowledgeTitle?: string | null;
  blocked?: 'price' | 'promise' | 'ungrounded' | null; original?: string;
};

export type Resolved = { reply: string; source: SimSource; faqQuestion: string | null; knowledgeTitle: string | null; blocked: 'price' | 'promise' | 'ungrounded' | null; original: string };
export type AnswerOutcome =
  | { ok: true; dryRun: boolean; resolved: Resolved; answer: { kind: string; reply: string; faq_question: string | null; lead: Record<string, string | null> | null; lead_complete: boolean; confidence: number } }
  | { ok: false; dryRun: boolean; reason: string; detail: string };

export async function simulateAnswer(input: {
  text: string; history: { role: 'user' | 'assistant'; text: string }[];
  faq: { question: string; answer: string }[]; knowledge: { title: string; body: string }[];
  branches: string[]; mayQuotePrices: boolean; lead: Record<string, string | null> | null;
}): Promise<AnswerOutcome> {
  const { data, error } = await supabase.functions.invoke('ai-answer', { body: input });
  if (error) throw new Error(error.message);
  return data as AnswerOutcome;
}
