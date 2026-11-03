// student-discount — הנחה לתלמידה (הבעלים).
//
// ★ הזרימה ב-_shared/student-discount.ts: התוכנית במסד בהרשאות המשתמשת (בעלים בלבד). בלי הוראת
//   קבע פעילה — שמירה במסד. עם הוראה פעילה — הסכום החודשי ב-SUMIT קודם (בדיקה, עדכון, אימות:
//   3 קריאות), ורק אחר כך אצלנו + יומן.
import { adminClient, userClient } from '../_shared/supabase.ts';
import { preflight, withCors } from '../_shared/cors.ts';
import { requireUserJwt, decodeJwtPayload } from '../_shared/guard.ts';
import { standingProvider } from '../_shared/standing.ts';
import { applyStudentDiscount } from '../_shared/student-discount.ts';

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
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: 'גוף הבקשה אינו JSON תקין' }, 400); }

  const authorization = req.headers.get('authorization') ?? '';
  const by = String(decodeJwtPayload(authorization.replace(/^Bearer\s+/i, ''))?.sub ?? '') || null;
  const out = await applyStudentDiscount(userClient(authorization), adminClient(), standingProvider(), body, by);
  if (!out.body.ok) console.error('[student-discount]', out.status, out.body.error);
  return json(out.body, out.status);
}
