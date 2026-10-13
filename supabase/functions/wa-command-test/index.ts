// wa-command-test — צ'אט הבדיקה במסך "פקודות וואטסאפ" (בעלים בלבד).
//
// מריץ הודעה דרך המנוע האמיתי (routeIncoming — ראו _shared/command-test.ts), בשם
// מספר מורשה שהבעלים בוחרת. התשובה חוזרת למסך; שום הודעת וואטסאפ לא נשלחת.
import { adminClient, userClient } from '../_shared/supabase.ts';
import { preflight, withCors } from '../_shared/cors.ts';
import { requireUserJwt } from '../_shared/guard.ts';
import { alertOwner } from '../_shared/alerts.ts';
import { runTestMessage } from '../_shared/command-test.ts';

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
  // ★ בעלים בלבד — נבדק במסד, בהרשאות המשתמשת עצמה. הצ'אט מבצע פעולות אמיתיות.
  const { data: role } = await userClient(req.headers.get('authorization') ?? '').rpc('auth_role');
  if (role !== 'owner') return json({ ok: false, error: 'רק הבעלים' }, 403);
  if (req.method !== 'POST') return json({ ok: false, error: 'שיטה לא נתמכת' }, 405);

  let body: { phone?: string; text?: string };
  try { body = await req.json(); } catch { return json({ ok: false, error: 'גוף הבקשה אינו JSON תקין' }, 400); }

  const db = adminClient();
  const out = await runTestMessage(db, { alert: (a) => alertOwner(db, a) }, body);
  return json(out, out.ok ? 200 : 400);
}
