// standing-order-reschedule — "שינוי יום חיוב" בהוראת קבע (הבעלים).
//
// ★ הזרימה ב-_shared/standing-reschedule.ts: התוכנית במסד בהרשאות המשתמשת (בעלים בלבד),
//   המצב העדכני מ-SUMIT, ורק אם SUMIT אישרה את העדכון — התאריך אצלנו + יומן.
//   שתי קריאות ל-SUMIT לכל שינוי (בדיקה + עדכון).
import { adminClient, userClient } from '../_shared/supabase.ts';
import { preflight, withCors } from '../_shared/cors.ts';
import { requireUserJwt, decodeJwtPayload } from '../_shared/guard.ts';
import { standingProvider } from '../_shared/standing.ts';
import { rescheduleStanding } from '../_shared/standing-reschedule.ts';

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
  let body: { id?: unknown; day?: unknown; expected?: unknown } = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: 'גוף הבקשה אינו JSON תקין' }, 400); }

  const authorization = req.headers.get('authorization') ?? '';
  const by = String(decodeJwtPayload(authorization.replace(/^Bearer\s+/i, ''))?.sub ?? '') || null;
  const out = await rescheduleStanding(userClient(authorization), adminClient(), standingProvider(), body, by);
  if (!out.body.ok) console.error('[standing-order-reschedule]', out.status, out.body.error);
  return json(out.body, out.status);
}
