/**
 * CORS לפונקציות שהדפדפן קורא ישירות (enroll, sumit-checkout). הדפדפן
 * שולח OPTIONS לפני ה-POST; בלי תשובה מתאימה ה-POST לא יוצא בכלל, והמשתמשת
 * רואה "שגיאת רשת". המקורות המותרים: האתר (settings.app_base_url = APP_BASE_URL)
 * ופיתוח מקומי. השומרים של הפונקציה עדיין רצים על ה-POST עצמו.
 */
import { env } from './env.ts';

const ALLOWED = new Set([
  env('APP_BASE_URL') ?? 'https://teichtal-crm.netlify.app',
  'https://teichtal-crm.netlify.app',
  'http://localhost:5173', 'http://localhost:4173',
]);

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  return {
    'access-control-allow-origin': ALLOWED.has(origin) ? origin : 'https://teichtal-crm.netlify.app',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

/** תשובת preflight. מוחזרת לפני השומר: OPTIONS אין בו גוף ואין בו טוקן. */
export function preflight(req: Request): Response | null {
  return req.method === 'OPTIONS' ? new Response(null, { status: 204, headers: corsHeaders(req) }) : null;
}

export function withCors(req: Request, res: Response): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders(req))) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}
