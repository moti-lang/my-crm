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
