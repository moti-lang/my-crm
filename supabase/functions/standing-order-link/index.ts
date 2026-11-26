// standing-order-link — "חיבור הוראת קבע מ-SUMIT" (הבעלים, מכרטיס התלמידה).
//
// הוראה שנפתחה ידנית ב-SUMIT (לא דרך קישור ההרשמה) — מחוברת לתלמידה, ומשם הסנכרון מנהל אותה כרגיל.
// ★ הסדר: ההרשאה נבדקת במסד בהרשאות המשתמשת (rpc_standing_link_request: בעלים, תלמידה בלי הוראה חיה)
//   לפני כל פנייה ל-SUMIT. ב-link — ההוראה נשלפת שוב מ-SUMIT (לא סומכים על מה שהדפדפן שלח), ורק אז נכתבת.
// פעולות:
//   list {student, customer_id}                       → ההוראות של הלקוח ב-SUMIT (בלי אלה שכבר מחוברות)
//   link {student, customer_id, recurring_id, total}  → יוצרת את ההוראה אצלנו
import { adminClient, userClient } from '../_shared/supabase.ts';
import { preflight, withCors } from '../_shared/cors.ts';
import { requireUserJwt, decodeJwtPayload } from '../_shared/guard.ts';
import { standingProvider } from '../_shared/standing.ts';
import { linkableItems } from '../_shared/standing-link.ts';

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
  let body: { action?: string; student?: string; customer_id?: unknown; recurring_id?: unknown; total?: unknown } = {};
  try { body = await req.json(); } catch { /* ריק */ }
  const action = String(body.action ?? 'list');
  const student = String(body.student ?? '');
  const customer = Number(body.customer_id);
  if (!/^[0-9a-f-]{36}$/i.test(student)) return json({ ok: false, error: 'מזהה תלמידה לא תקין' }, 400);
  if (!Number.isSafeInteger(customer) || customer <= 0) return json({ ok: false, error: 'מספר הלקוח ב-SUMIT: מספר בלבד' }, 400);
  if (!['list', 'link'].includes(action)) return json({ ok: false, error: 'פעולה לא מוכרת' }, 400);

  const authorization = req.headers.get('authorization') ?? '';
  const { data: allowed, error } = await userClient(authorization).rpc('rpc_standing_link_request', { p_student: student, p_customer: customer });
  if (error) return json({ ok: false, error: error.message }, 403);
  const linked = ((allowed as { linked?: number[] })?.linked ?? []).map(Number);

  let items;
  try {
    items = linkableItems(await standingProvider().list(customer), linked);
  } catch (e) {
    return json({ ok: false, error: `SUMIT לא החזירה את ההוראות של הלקוח: ${e instanceof Error ? e.message : 'שגיאה'}` }, 502);
  }
  if (action === 'list') return json({ ok: true, items });

  const recurring = Number(body.recurring_id), total = Number(body.total);
  const item = items.find((i) => i.id === recurring);
  if (!item) return json({ ok: false, error: 'ההוראה לא נמצאה אצל הלקוח הזה ב-SUMIT (או שכבר מחוברת)' }, 404);
  if (!item.linkable) return json({ ok: false, error: `אי אפשר לחבר: ${item.reason}` }, 409);
  const by = String(decodeJwtPayload(authorization.replace(/^Bearer\s+/i, ''))?.sub ?? '') || null;
  const { data, error: lErr } = await adminClient().rpc('rpc_standing_link_external', {
    p_student: student, p_customer: customer, p_recurring: recurring, p_amount: item.amount, p_total: total,
    p_sumit_status: item.status, p_next: item.next, p_prev: item.prev, p_final: item.last, p_by: by,
  });
  if (lErr) return json({ ok: false, error: lErr.message }, 400);
  return json(data);
}
