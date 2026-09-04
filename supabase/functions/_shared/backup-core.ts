/**
 * הליבה הטהורה של הגיבוי היומי — בלי רשת, בלי מסד. כאן כדי שבדיקה
 * ב-Node תוכל לאמת כל החלטה: מתי רצים, לצרף או לקשר, מה למחוק, ומה
 * נחשב קובץ תקין.
 */
export const BUCKET = 'backups';
export const KEEP = 30;
export const ATTACH_LIMIT = 20 * 1024 * 1024;
export const RUN_HOUR = 22; // שעון ישראל

export function jerusalemHour(d = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', hour: 'numeric', hour12: false }).format(d));
}
export function jerusalemDate(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** ה-cron יורה ב-19:00 וב-20:00 UTC (קיץ/חורף). רצים רק כשבישראל 22:00. */
export function shouldRunNow(d = new Date()): boolean {
  return jerusalemHour(d) === RUN_HOUR;
}

export function objectName(d = new Date()): string {
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(':', '');
  return `teichtal-${jerusalemDate(d)}-${hm}.json`;
}

export type Delivery = { mode: 'attach' } | { mode: 'link' };
export function deliveryPlan(sizeBytes: number): Delivery {
  return sizeBytes < ATTACH_LIMIT ? { mode: 'attach' } : { mode: 'link' };
}

/** שמות למחיקה: כל מה שמעבר ל-KEEP האחרונים, לפי שם (התאריך בשם). */
export function pruneList(names: string[], keep = KEEP): string[] {
  const ours = names.filter((n) => /^teichtal-\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(n)).sort();
  return ours.length > keep ? ours.slice(0, ours.length - keep) : [];
}

export type Manifest = { format: string; taken_at: string; counts: Record<string, number>; migrations?: string | null };

/**
 * אימות של מה שנשמר: הקובץ שהורד בחזרה נפרס, בפורמט הנכון, וכל טבלה
 * מכילה בדיוק את מספר השורות שבמניפסט. זה מה שמבדיל "הועלה" מ"ניתן לשחזור".
 */
export function verifyBackupText(text: string): { ok: true; manifest: Manifest; tables: number; rows: number } | { ok: false; reason: string } {
  let parsed: { manifest?: Manifest; data?: Record<string, unknown[]> };
  try { parsed = JSON.parse(text); } catch { return { ok: false, reason: 'הקובץ אינו JSON תקין' }; }
  const m = parsed.manifest;
  if (!m || m.format !== 'teichtal-backup/1') return { ok: false, reason: 'פורמט לא מוכר' };
  if (!parsed.data || typeof parsed.data !== 'object') return { ok: false, reason: 'אין data' };
  let rows = 0;
  for (const [table, n] of Object.entries(m.counts ?? {})) {
    const arr = parsed.data[table];
    if (!Array.isArray(arr)) return { ok: false, reason: `חסרה הטבלה ${table}` };
    if (arr.length !== n) return { ok: false, reason: `${table}: ${arr.length} שורות במקום ${n}` };
    rows += n;
  }
  const tables = Object.keys(m.counts ?? {}).length;
  if (tables === 0) return { ok: false, reason: 'מניפסט ריק' };
  if (!m.counts['auth.users'] && m.counts['auth.users'] !== 0) return { ok: false, reason: 'auth.users חסרה — בלי המשתמשות אין שחזור' };
  return { ok: true, manifest: m, tables, rows };
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
