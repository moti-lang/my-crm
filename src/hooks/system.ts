import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type WaHealth = {
  status: 'unknown' | 'up' | 'down';
  checked_at: string | null;
  last_ok_at: string | null;
  consecutive_failures: number;
  error: string | null;
};

const DEFAULT_HEALTH: WaHealth = {
  status: 'unknown', checked_at: null, last_ok_at: null, consecutive_failures: 0, error: null,
};

/**
 * מצב החיבור לשרת הוואטסאפ.
 * מתרענן כל דקה — כשהחיבור נופל, הזמן עד שרואים את זה הוא מה שקובע
 * אם התזכורות חוזרות היום או בעוד שבוע.
 */
export function useWaHealth() {
  return useQuery({
    queryKey: ['wa-health'],
    refetchInterval: 60_000,
    queryFn: async (): Promise<WaHealth> => {
      const { data, error } = await supabase
        .from('settings').select('value').eq('key', 'wa_health').maybeSingle();
      if (error) throw new Error(error.message);
      return { ...DEFAULT_HEALTH, ...((data?.value ?? {}) as Partial<WaHealth>) };
    },
  });
}

export function useOpenAlerts() {
  return useQuery({
    queryKey: ['system-alerts'],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_alerts').select('*')
        .is('acknowledged_at', null)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export type LastBackup = {
  ok: boolean; at: string; name: string; size: number; tables: number; rows: number;
  mail: 'sent' | 'failed' | 'off'; error: string | null;
};

/** הריצה האחרונה של הגיבוי היומי. null = עדיין לא רץ אף פעם. */
export function useLastBackup() {
  return useQuery({
    queryKey: ['last-backup'],
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<LastBackup | null> => {
      const { data, error } = await supabase.from('settings').select('value').eq('key', 'last_backup').maybeSingle();
      if (error) throw new Error(error.message);
      return (data?.value as LastBackup | undefined) ?? null;
    },
  });
}
