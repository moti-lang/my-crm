// wa-admin — מצב חיבור הוואטסאפ ו-QR, מתוך מסך ההגדרות (בעלים בלבד).
//
// הדפדפן לא מקבל אף פעם את מפתח ה-API או את כתובת השרת עם סיסמה: הקריאה לשרת
// נעשית כאן, וחוזרים רק מצב, QR (תמונה) ופרטי המספר המחובר.
// פעולות: status (ברירת מחדל) · connect (מייצר QR) · disconnect.
import { userClient } from '../_shared/supabase.ts';
import { preflight, withCors } from '../_shared/cors.ts';
import { requireUserJwt } from '../_shared/guard.ts';
import { waConfig } from '../_shared/wa.ts';

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
  // ★ בעלים בלבד — נבדק במסד, בהרשאות המשתמשת עצמה.
  const { data: role } = await userClient(req.headers.get('authorization') ?? '').rpc('auth_role');
  if (role !== 'owner') return json({ ok: false, error: 'רק הבעלים' }, 403);

  let action = 'status';
  if (req.method === 'POST') { try { action = String(((await req.json()) as { action?: string }).action ?? 'status'); } catch { /* status */ } }
  if (!['status', 'connect', 'disconnect'].includes(action)) return json({ ok: false, error: 'פעולה לא מוכרת' }, 400);

  const cfg = await waConfig();
  if (!cfg) return json({ ok: true, configured: false });
  try {
    const res = await fetch(`${cfg.url}/api/${action}`, {
      method: action === 'status' ? 'GET' : 'POST',
      headers: { 'x-api-key': cfg.apiKey, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    const s = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return json({ ok: false, configured: true, server: cfg.url, error: `השרת החזיר ${res.status}` }, 502);
    const me = s.me as { phone?: string; name?: string; display?: string } | null | undefined;
    return json({
      ok: true, configured: true, server: cfg.url,
      state: s.state ?? null, qrDataUrl: s.qrDataUrl ?? null,
      me: me ? { phone: me.display ?? me.phone ?? null, name: me.name ?? null } : null,
    });
  } catch (e) {
    return json({ ok: false, configured: true, server: cfg.url, error: `השרת לא עונה: ${(e as Error).message}` }, 502);
  }
}
