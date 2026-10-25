import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Tables, Views } from '@/lib/database.types';

// מיילים להורים (בעלים בלבד — RLS על הטבלאות). השליחה עצמה בשרת: email-send / cron-email.
export type EmailCampaign = Views<'v_email_campaigns'>;
export type EmailMessage = Tables<'email_messages'>;
export type Attachment = { name: string; type: string; b64: string };

export const MESSAGE_STATUS: Record<string, { label: string; tone: string }> = {
  queued: { label: 'ממתין', tone: 'bg-shade text-soft' },
  sending: { label: 'נשלח כעת', tone: 'bg-warn/15 text-warn' },
  sent: { label: 'נשלח', tone: 'bg-plum/10 text-plum' },
  delivered: { label: 'נמסר', tone: 'bg-ok/15 text-ok' },
  bounced: { label: 'חזר', tone: 'bg-bad/15 text-bad' },
  complained: { label: 'סומן כספאם', tone: 'bg-bad/15 text-bad' },
  failed: { label: 'נכשל', tone: 'bg-bad/15 text-bad' },
  cancelled: { label: 'בוטל', tone: 'bg-shade text-soft' },
};

/** תשובת 4xx/5xx מהפונקציה נושאת הסבר בעברית — מציגים אותו, לא "שגיאת שרת". */
async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('email-send', { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const payload = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
    if (payload && typeof payload === 'object') return payload as T;
    throw new Error(error.message);
  }
  return data as T;
}

export type EmailStatus = { ok: boolean; configured: boolean; from: string | null; replyTo: string | null; dailyCap: number };
export function useEmailStatus() {
  return useQuery({ queryKey: ['email-status'], queryFn: () => invoke<EmailStatus>({ action: 'status' }) });
}

export function useSuppressions() {
  return useQuery({
    queryKey: ['email-suppressions'],
    queryFn: async () => {
      const { data, error } = await supabase.from('email_suppressions').select('email, reason');
      if (error) throw new Error(error.message);
      return new Map((data ?? []).map((s) => [s.email, s.reason]));
    },
  });
}

export function useEmailCampaigns() {
  return useQuery({
    queryKey: ['email-campaigns'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_email_campaigns').select('*').order('created_at', { ascending: false }).limit(100);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    // בזמן שליחה המצב משתנה כל דקה.
    refetchInterval: (q) => ((q.state.data ?? []).some((c) => Number(c.pending ?? 0) > 0) ? 15_000 : false),
  });
}

export function useEmailMessages(campaignId: string | null) {
  return useQuery({
    queryKey: ['email-messages', campaignId],
    enabled: Boolean(campaignId),
    queryFn: async () => {
      const { data, error } = await supabase.from('email_messages')
        .select('id, to_email, to_name, subject, body, status, error, sent_at, delivered_at, created_at, student_id')
        .eq('campaign_id', campaignId as string).order('created_at');
      if (error) throw new Error(error.message);
      return (data ?? []) as EmailMessage[];
    },
  });
}

export type QueueResult = { ok: boolean; error?: string; queued?: number; personal?: boolean; configured?: boolean; skipped?: Record<string, number> };
export function useEmailActions() {
  const qc = useQueryClient();
  return {
    queue: async (input: { studentIds: string[]; subject: string; body: string; attachment: Attachment | null }) => {
      const r = await invoke<QueueResult>({ action: 'queue', ...input });
      await qc.invalidateQueries({ queryKey: ['email-campaigns'] });
      return r;
    },
    test: (input: { to: string; studentIds: string[]; subject: string; body: string; attachment: Attachment | null }) =>
      invoke<{ ok: boolean; error?: string; sample?: string }>({ action: 'test', ...input }),
  };
}

/** קובץ → base64 (בלי הקידומת data:). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(new Error('הקובץ לא נקרא'));
    r.readAsDataURL(file);
  });
}
