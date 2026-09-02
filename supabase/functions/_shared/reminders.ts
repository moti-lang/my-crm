import { renderTemplate, type TemplateVars } from './template.ts';

type Db = { from: (t: string) => any };

/** ₪1,234 — פורמט אחיד לכסף בכל הודעה יוצאת. */
export function formatILS(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : (value ?? 0);
  if (!Number.isFinite(n)) return '₪0';
  const rounded = Math.round(n);
  return `${rounded < 0 ? '-' : ''}₪${Math.abs(rounded).toLocaleString('he-IL')}`;
}

export async function loadTemplates(db: Db): Promise<Map<string, { name: string; body: string; kind: string }>> {
  const { data } = await db.from('message_templates').select('key, name, body, kind').eq('is_active', true);
  return new Map((data ?? []).map((t: { key: string; name: string; body: string; kind: string }) => [t.key, t]));
}

export async function readSetting<T>(db: Db, key: string, fallback: T): Promise<T> {
  const { data } = await db.from('settings').select('value').eq('key', key).maybeSingle();
  return (data?.value as T) ?? fallback;
}

/** האם האוטומציה הזו מופעלת. כיבוי מההגדרות עוצר בלי לגעת בקוד. */
export async function automationEnabled(db: Db, name: string): Promise<boolean> {
  const flags = await readSetting<Record<string, boolean>>(db, 'automations', {});
  return flags[name] !== false;
}

/**
 * מכניס תזכורת לתור.
 *
 * dedupeKey הוא מה שמונע מ-cron יומי לשלוח את אותה הודעה כל בוקר.
 * התנגשות (23505) אינה שגיאה — היא בדיוק המנגנון עובד.
 * מחזיר true אם נוצרה תזכורת חדשה.
 */
export async function queueReminder(
  db: Db,
  reminder: {
    kind: string;
    student_id?: string | null;
    branch_id?: string | null;
    to_phone: string;
    to_label?: string | null;
    templateBody: string;
    vars: TemplateVars;
    scheduled_at?: string;
    dedupeKey?: string | null;
  },
): Promise<boolean> {
  const body = renderTemplate(reminder.templateBody, reminder.vars);
  if (!body) {
    console.warn('[queueReminder] הודעה ריקה אחרי הרכבה — לא נשמרה', reminder.dedupeKey);
    return false;
  }

  const { error } = await db.from('reminders').insert({
    kind: reminder.kind,
    student_id: reminder.student_id ?? null,
    branch_id: reminder.branch_id ?? null,
    to_phone: reminder.to_phone,
    to_label: reminder.to_label ?? null,
    body,
    scheduled_at: reminder.scheduled_at ?? new Date().toISOString(),
    status: 'scheduled',
    dedupe_key: reminder.dedupeKey ?? null,
  });

  if (error) {
    if (error.code === '23505') return false;   // כבר נשלחה — זה המנגנון
    throw new Error(error.message);
  }
  return true;
}
