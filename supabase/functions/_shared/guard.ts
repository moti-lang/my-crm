import { requireEnv } from './env.ts';

/**
 * שומרי הכניסה של Edge Functions. verify_jwt של הפלטפורמה אינו מספיק:
 * הוא מקבל גם את מפתח ה-anon הציבורי (שנמצא בבילד), ו-false פירושו
 * שכל מי שיודע את הכתובת קורא לפונקציה.
 *
 * שני שומרים, ואין פונקציה בלעדיהם (נאכף ב-function-guards.test.mjs
 * וב-scripts/functions-deploy-api.mjs, שמסרב לפרוס פונקציה בלי שומר):
 *   requireCronSecret — פונקציות פנימיות: cron-*, wa-send. הקוראים הם
 *     pg_cron ופונקציות אחרות, עם CRON_SECRET שמונפק ב-scripts/schedule-backup.mjs.
 *   requireUserJwt — פונקציות שהדפדפן קורא: JWT של משתמשת מחוברת
 *     (role=authenticated), לא מפתח anon. החתימה כבר אומתה ב-verify_jwt.
 *   requireSharedSecret — webhook של ספק בלי חתימה (SUMIT): סוד משותף
 *     בכותרת, השוואה בזמן קבוע. הגוף הוא רמז בלבד; האמת נשאלת מהספק.
 *   requirePayToken — /pay/<טוקן>: הטוקן עצמו הוא ההרשאה (64 תווי הקס),
 *     והמסד מאמת אותו. כאן רק הצורה, כדי לא להריץ כלום על קלט זבל.
 *   requireEnrollBody — דף ההרשמה (ציבורי בכוונה): הצורה בלבד — POST, JSON
 *     קטן, עם שדות ההרשמה. ההרשאה האמיתית היא הגבלת הקצב במסד.
 * wa-webhook מוגנת בחתימת HMAC של ה-Hub (verifyHubSignature) ואינה כאן.
 */
const deny = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } });

export function requireCronSecret(req: Request): Response | null {
  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${requireEnv('CRON_SECRET')}`) return deny(401, 'unauthorized');
  return null;
}

export function requireUserJwt(req: Request): Response | null {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const payload = decodeJwtPayload(token);
  if (!payload || payload.role !== 'authenticated' || typeof payload.sub !== 'string') {
    return deny(403, 'נדרשת התחברות של משתמשת, לא מפתח anon');
  }
  return null;
}

/** קריאת ה-payload בלבד. החתימה אומתה כבר ב-verify_jwt של הפלטפורמה. */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
  } catch { return null; }
}

/** השוואה בזמן קבוע, בלי תלות באורך: שני הצדדים נדחסים ל-SHA-256 קודם. */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0 && a.length > 0;
}

export async function requireSharedSecret(req: Request, envKey: string, header = 'x-webhook-secret'): Promise<Response | null> {
  const expected = requireEnv(envKey);
  const given = req.headers.get(header) ?? new URL(req.url).searchParams.get('secret') ?? '';
  if (!(await constantTimeEqual(given, expected))) return deny(401, 'unauthorized');
  return null;
}

export function requirePayToken(req: Request): Response | null {
  const token = new URL(req.url).searchParams.get('token') ?? '';
  if (!/^[0-9a-f]{64}$/.test(token)) return deny(401, 'קישור לא תקין');
  return null;
}

const ENROLL_FIELDS = ['first_name', 'last_name', 'grade', 'school', 'phone', 'email', 'branch_id', 'terms_accepted'];
export async function requireEnrollBody(req: Request): Promise<Response | null> {
  if (req.method !== 'POST') return deny(405, 'שיטה לא נתמכת');
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > 4096) return deny(413, 'הבקשה גדולה מדי');
  let body: unknown;
  try { body = await req.clone().json(); } catch { return deny(400, 'גוף הבקשה אינו JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return deny(400, 'גוף הבקשה אינו אובייקט');
  const keys = Object.keys(body as object);
  if (keys.length > 12 || !ENROLL_FIELDS.every((k) => k in (body as object))) return deny(400, 'חסרים שדות הרשמה');
  return null;
}
