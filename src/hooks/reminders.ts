import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Enums } from '@/lib/database.types';

export function useReminders() {
  return useQuery({
    queryKey: ['reminders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reminders').select('*')
        .order('scheduled_at', { ascending: false })
        .limit(150);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useMessageTemplates() {
  return useQuery({
    queryKey: ['message-templates'],
    queryFn: async () => {
      const { data, error } = await supabase.from('message_templates').select('*').order('name');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useUpdateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; body: string; is_active: boolean }) => {
      const { error } = await supabase
        .from('message_templates')
        .update({ body: input.body, is_active: input.is_active })
        .eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['message-templates'] });
      await qc.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}

export type Automations = Record<string, boolean>;

export function useAutomations() {
  return useQuery({
    queryKey: ['automations'],
    queryFn: async (): Promise<Automations> => {
      const { data, error } = await supabase
        .from('settings').select('value').eq('key', 'automations').maybeSingle();
      if (error) throw new Error(error.message);
      return (data?.value as Automations) ?? {};
    },
  });
}

export function useSetAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { current: Automations; name: string; enabled: boolean }) => {
      const next = { ...input.current, [input.name]: input.enabled };
      const { error } = await supabase
        .from('settings').update({ value: next }).eq('key', 'automations');
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['automations'] }); },
  });
}

export function useScheduleReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      kind: Enums<'reminder_kind'>;
      to_phone: string;
      to_label: string;
      body: string;
      scheduled_at: string;
      student_id?: string | null;
      branch_id?: string | null;
    }) => {
      const { error } = await supabase.from('reminders').insert(input);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['reminders'] }); },
  });
}

export function useCancelReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('reminders').update({ status: 'cancelled' }).eq('id', id).eq('status', 'scheduled');
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['reminders'] }); },
  });
}
