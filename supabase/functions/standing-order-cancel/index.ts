// standing-order-cancel — "עצירת הוראת קבע" (הבעלים).
//
// ★ מבטלת ב-SUMIT קודם, ורק אם SUMIT אישרה — מסמנת אצלנו. ביטול שנכשל
//   ב-SUMIT לא מסומן כמבוטל (אחרת החיובים ממשיכים ואנחנו חושבים שלא).
// ההרשאה נבדקת במסד בהרשאות המשתמשת (rpc_standing_order_cancel_request:
// בעלים בלבד), לא כאן.
import { adminClient, userClient } from '../_shared/supabase.ts';
import { preflight, withCors } from '../_shared/cors.ts';
import { requireUserJwt, decodeJwtPayload } from '../_shared/guard.ts';
import { standingProvider } from '../_shared/standing.ts';

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
  let id = '';
  try { id = String(((await req.json()) as { id?: string }).id ?? ''); } catch { /* ריק */ }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ ok: false, error: 'מזהה לא תקין' }, 400);

  const authorization = req.headers.get('authorization') ?? '';
  const { data: ids, error } = await userClient(authorization).rpc('rpc_standing_order_cancel_request', { p_id: id });
  if (error) return json({ ok: false, error: error.message }, 403);
  const { customer_id, recurring_id } = ids as { customer_id: number; recurring_id: number };

  const r = await standingProvider().cancel(Number(customer_id), Number(recurring_id));
  if (!r.ok) {
    console.error('[standing-order-cancel] SUMIT סירבה', id, r.error);
    return json({ ok: false, error: `SUMIT לא ביטלה את ההוראה: ${r.error}. ההוראה עדיין פעילה.` }, 502);
  }
  const by = String(decodeJwtPayload(authorization.replace(/^Bearer\s+/i, ''))?.sub ?? '');
  const { error: mErr } = await adminClient().rpc('rpc_standing_order_cancelled', { p_id: id, p_by: by || null });
  if (mErr) return json({ ok: false, error: 'בוטל ב-SUMIT, אבל הסימון אצלנו נכשל — הסנכרון יעדכן בריצה הבאה' }, 500);
  return json({ ok: true });
}
