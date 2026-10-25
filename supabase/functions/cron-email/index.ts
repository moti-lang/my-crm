// cron-email — שולחת את תור המיילים להורים (pg_cron, כל דקה כשיש מה לשלוח).
// לא בשבת ובחגים, בתוך התקרה היומית של הספק, בקצב שלו. ראו _shared/email-flow.ts.
import { adminClient } from '../_shared/supabase.ts';
import { requireCronSecret } from '../_shared/guard.ts';
import { sendMail, mailConfig } from '../_shared/mail.ts';
import { processQueue } from '../_shared/email-flow.ts';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  const denied = requireCronSecret(req);
  if (denied) return denied;
  try {
    const r = await processQueue(adminClient(), sendMail, mailConfig());
    if (r.claimed) console.log(`[cron-email] ${r.sent} נשלחו, ${r.failed} נכשלו`);
    return json(r);
  } catch (e) {
    console.error('[cron-email] נכשל', e);
    return json({ error: 'שליחת המיילים נכשלה' }, 500);
  }
});
