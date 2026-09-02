type Db = { from: (t: string) => any };

export type WaHealth = {
  status: 'unknown' | 'up' | 'down';
  checked_at: string | null;
  last_ok_at: string | null;
  consecutive_failures: number;
  error: string | null;
};

const DEFAULT: WaHealth = {
  status: 'unknown', checked_at: null, last_ok_at: null, consecutive_failures: 0, error: null,
};

export async function readWaHealth(db: Db): Promise<WaHealth> {
  const { data } = await db.from('settings').select('value').eq('key', 'wa_health').maybeSingle();
  return { ...DEFAULT, ...((data?.value ?? {}) as Partial<WaHealth>) };
}

export async function writeWaHealth(db: Db, health: WaHealth): Promise<void> {
  await db.from('settings').upsert({ key: 'wa_health', value: health }, { onConflict: 'key' });
}

/**
 * האם מותר לשלוח עכשיו.
 * כשהחיבור נפול עוצרים את התור ומשאירים את התזכורות ב-'scheduled' —
 * לעולם לא מסמנים 'sent' הודעה שלא יצאה.
 */
export function maySend(health: WaHealth): boolean {
  return health.status !== 'down';
}
