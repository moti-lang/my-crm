/** קריאת משתני סביבה. אין מפתחות בקוד, ואין מפתחות בפרונט. */
export function env(key: string): string | undefined {
  return Deno.env.get(key);
}

export function requireEnv(key: string): string {
  const v = Deno.env.get(key);
  if (!v) throw new Error(`חסר משתנה סביבה: ${key}`);
  return v;
}

/** ברירת המחדל היא dry-run: בלי הדגל הזה שום הודעה לא יוצאת החוצה. */
export const WA_DRY_RUN = (Deno.env.get('WA_DRY_RUN') ?? 'true') !== 'false';
export const AI_DRY_RUN = (Deno.env.get('AI_DRY_RUN') ?? 'true') !== 'false';
