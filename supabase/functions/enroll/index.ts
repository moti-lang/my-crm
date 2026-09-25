// enroll — דף ההרשמה הציבורי שולח לכאן, לא ישירות ל-RPC.
//
// הסיבה היחידה לפונקציה: ה-IP. PostgREST לא מעביר אותו למסד, ולכן הגבלת
// קצב לפי IP אפשרית רק כאן. rpc_enroll עצמה כבר לא פתוחה ל-anon (0024) —
// אין דרך לעקוף את הפונקציה ולהגיע למסד בלי IP.
// כל האימות, הכפילויות והמגבלות (טלפון / IP / כללי) — במסד, כמו קודם.
import { adminClient } from '../_shared/supabase.ts';
import { requireEnrollBody } from '../_shared/guard.ts';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

/** ה-IP האמיתי של הקוראת: הפלטפורמה שמה אותו ב-x-forwarded-for (הראשון). */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for') ?? '';
  const first = xff.split(',')[0]?.trim() ?? '';
  return first || req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || 'unknown';
}

Deno.serve(async (req) => {
  const denied = await requireEnrollBody(req);
  if (denied) return denied;

  const body = await req.clone().json() as Record<string, unknown>;
  const db = adminClient();
  const { data, error } = await db.rpc('rpc_enroll', { p: body, p_ip: clientIp(req) });
  if (error) {
    console.error('[enroll]', error.message);
    return json({ ok: false, error: 'לא הצלחנו לשלוח את ההרשמה. נסי שוב.' }, 500);
  }
  return json(data);
});
