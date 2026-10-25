// email-webhook — אירועי מסירה מ-Resend: נמסר / חזר / סומן כספאם / עיכוב.
// מאומת בחתימת Svix (requireResendSignature) לפני כל נגיעה במסד. ראו _shared/email-flow.ts.
import { adminClient } from '../_shared/supabase.ts';
import { requireResendSignature } from '../_shared/guard.ts';
import { handleResendEvent } from '../_shared/email-flow.ts';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  const denied = await requireResendSignature(req);
  if (denied) return denied;
  let event: unknown;
  try { event = JSON.parse(await req.text()); } catch { return json({ ok: false, error: 'גוף לא תקין' }, 400); }
  try {
    return json(await handleResendEvent(adminClient(), event as Parameters<typeof handleResendEvent>[1]));
  } catch (e) {
    console.error('[email-webhook] נכשל', e);
    return json({ ok: false }, 500);
  }
});
