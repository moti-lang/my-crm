// standing-order-retry — "ניסיון חיוב חוזר" בהוראת קבע שהושבתה אחרי חיוב שנכשל (הבעלים).
//
// ★ הזרימה ב-_shared/standing-retry.ts: התוכנית במסד בהרשאות המשתמשת (בעלים בלבד), המצב ב-SUMIT
//   (רק "הושבתה אחרי כישלון"), חיוב אחד על הכרטיס השמור — נרשם מיד, עבר או נדחה — ואם עבר:
//   הוראה חדשה לחיובים שנותרו. חידוש שנכשל — הלחיצה הבאה רק מחדשת, בלי חיוב נוסף.
import { adminClient, userClient } from '../_shared/supabase.ts';
import { preflight, withCors } from '../_shared/cors.ts';
import { requireUserJwt, decodeJwtPayload } from '../_shared/guard.ts';
import { standingProvider } from '../_shared/standing.ts';
import { retryStanding } from '../_shared/standing-retry.ts';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  return withCors(req, await handle(req));
});

async function handle(req: Request): Promise<Response> {
  const denied = requireUserJwt(req);
  if (denied) return denied;
  if (req.method !== 'POST') return json({ ok: false, error: 'שיטה לא נתמכת' }, 405);
  let body: { id?: unknown; stage?: unknown; next?: unknown } = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: 'גוף הבקשה אינו JSON תקין' }, 400); }

  const authorization = req.headers.get('authorization') ?? '';
  const by = String(decodeJwtPayload(authorization.replace(/^Bearer\s+/i, ''))?.sub ?? '') || null;
  const out = await retryStanding(userClient(authorization), adminClient(), standingProvider(), body, by);
  if (!out.body.ok) console.error('[standing-order-retry]', out.status, out.body.error);
  return json(out.body, out.status);
}
