// wa-provision — שרת הוואטסאפ החדש "מתקשר הביתה" בסוף ההתקנה.
//
// מקבל: כתובת (https), מפתח API וסוד webhook שהשרת יצר לעצמו. לפני שמירה —
// מוודאים שהשרת באמת עונה בכתובת הזו עם המפתח הזה (/api/status). כך אי אפשר
// להזריק כתובת שאינה השרת שלנו גם עם טוקן שדלף.
// הטוקן: חד-פעמי, תוקף מוגבל, נשמר כ-hash (rpc_wa_provision). אחרי שימוש — נמחק.
import { adminClient } from '../_shared/supabase.ts';
import { requireProvisionToken } from '../_shared/guard.ts';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  const denied = requireProvisionToken(req);
  if (denied) return denied;
  let body: { server_url?: string; api_key?: string; webhook_secret?: string; report?: string } = {};
  try { body = await req.json(); } catch { /* ריק */ }

  // דיווח התקדמות/שגיאה מההתקנה: סוף הלוג. לא מנצל את הטוקן.
  if (typeof body.report === 'string') {
    const { data, error } = await adminClient().rpc('rpc_wa_setup_report', { p_token: req.headers.get('x-provision-token'), p_log: body.report });
    if (error) return json({ ok: false, error: error.message }, 500);
    const r = data as { ok: boolean };
    return json(r, r.ok ? 200 : 401);
  }
  const url = String(body.server_url ?? '').replace(/\/+$/, '');
  const apiKey = String(body.api_key ?? '');
  const secret = String(body.webhook_secret ?? '');
  if (!/^https:\/\/[a-z0-9.-]+$/.test(url) || apiKey.length < 32 || secret.length < 32) return json({ ok: false, error: 'פרטים לא תקינים' }, 400);

  // השרת עונה בכתובת הזו, עם המפתח הזה?
  try {
    const res = await fetch(`${url}/api/status`, { headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return json({ ok: false, error: `השרת לא אישר את המפתח (${res.status})` }, 400);
  } catch (e) {
    return json({ ok: false, error: `השרת לא עונה ב-${url}: ${(e as Error).message}` }, 400);
  }

  const { data, error } = await adminClient().rpc('rpc_wa_provision', {
    p_token: req.headers.get('x-provision-token'), p_url: url, p_api_key: apiKey, p_webhook_secret: secret,
  });
  if (error) return json({ ok: false, error: error.message }, 500);
  const r = data as { ok: boolean; error?: string };
  return json(r, r.ok ? 200 : 401);
});
