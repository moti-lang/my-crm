// wa-admin — מסך "חיבור וואטסאפ" (בהגדרות, בעלים בלבד): מצב, QR לסריקה, וניתוק.
//
// ★ הדפדפן לא מקבל אף פעם את הסיסמה של GOWA: הפנייה ל-GOWA נעשית כאן (דרך _shared/wa.ts),
//   ותמונת ה-QR נשלפת כאן וחוזרת כתמונה בלבד (data URL).
// ★ בעלים בלבד — נבדק במסד בהרשאות המשתמשת עצמה, לפני כל פנייה ל-GOWA.
// ★ בלי הגדרות (אין סודות עדיין): { configured: false } — המסך מציג "לא מוגדר", בלי שגיאה.
// פעולות: status (ברירת מחדל) · connect (QR) · disconnect.
import { userClient } from '../_shared/supabase.ts';
import { preflight, withCors } from '../_shared/cors.ts';
import { requireUserJwt } from '../_shared/guard.ts';
import { whatsappProvider, waConfig, waDryRun, waTestPhone, type WaStatus } from '../_shared/wa.ts';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  return withCors(req, await handle(req));
});

/** מצב השליחה, למסך: הרצה יבשה / מספר בדיקה בלבד / שליחה אמיתית. מספר הבדיקה — רק 4 הספרות האחרונות. */
function mode() {
  const test = waTestPhone();
  return { dryRun: waDryRun(), testPhoneTail: test ? test.slice(-4) : null };
}

function view(s: WaStatus) {
  if (!s.configured) return { ok: true, configured: false, mode: mode() };
  if (!s.ok) return { ok: false, configured: true, error: s.error, mode: mode() };
  const state = !s.loggedIn ? 'logged_out' : s.connected ? 'connected' : 'reconnecting';
  return { ok: true, configured: true, state, phone: s.phone, host: new URL(waConfig()!.baseUrl).host, mode: mode() };
}

async function handle(req: Request): Promise<Response> {
  const denied = requireUserJwt(req);
  if (denied) return denied;
  const { data: role } = await userClient(req.headers.get('authorization') ?? '').rpc('auth_role');
  if (role !== 'owner') return json({ ok: false, error: 'רק הבעלים' }, 403);

  let action = 'status';
  if (req.method === 'POST') { try { action = String(((await req.json()) as { action?: string }).action ?? 'status'); } catch { /* status */ } }
  if (!['status', 'connect', 'disconnect'].includes(action)) return json({ ok: false, error: 'פעולה לא מוכרת' }, 400);

  const wa = whatsappProvider();
  if (action === 'connect') {
    const qr = await wa.loginQr();
    if (qr.ok) return json({ ...view(await wa.status()), state: 'qr', qrDataUrl: qr.qrDataUrl, qrSeconds: qr.durationSec });
    if (!qr.alreadyLoggedIn && !qr.notConfigured) return json({ ...view(await wa.status()), ok: false, error: qr.error }, 502);
  }
  if (action === 'disconnect') {
    const out = await wa.logout();
    if (!out.ok && !out.notConfigured) return json({ ...view(await wa.status()), ok: false, error: out.error }, 502);
  }
  const v = view(await wa.status());
  return json(v, v.ok ? 200 : 502);
}
