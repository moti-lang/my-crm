// sumit-webhook — טריגר מ-SUMIT אחרי תשלום. **רמז בלבד.**
//
// SUMIT לא חותמת: הכניסה מוגנת בסוד משותף בכותרת x-webhook-secret
// (השוואה בזמן קבוע). מהגוף נלקח רק ה-ExternalIdentifier שלנו, ואז
// שואלים את SUMIT מה באמת קרה (syncPaymentLink). גוף מזויף עם "שולם"
// לא רושם כלום — כי הרישום קורה רק אחרי תשובת SUMIT.
import { adminClient } from '../_shared/supabase.ts';
import { requireSharedSecret } from '../_shared/guard.ts';
import { sumitProvider, extractIpnCandidates } from '../_shared/sumit.ts';
import { syncPaymentLink } from '../_shared/sumit-sync.ts';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  const denied = await requireSharedSecret(req, 'SUMIT_WEBHOOK_SECRET');
  if (denied) return denied;

  const raw = await req.text();
  const candidates = extractIpnCandidates(req.headers.get('content-type') ?? '', raw);
  const db = adminClient();
  // ★ כל IPN נרשם גולמי (sumit_ipn_log): הפורמט של SUMIT נלמד מהשטח, לא מניחים.
  const { data: found, error } = await db.rpc('rpc_sumit_ipn_received', { p_content_type: req.headers.get('content-type') ?? '', p_body: raw, p_candidates: candidates });
  if (error) return json({ ok: false, error: 'DB' }, 500);
  if (!found?.link) return json({ ok: true, ignored: 'לא זוהה קישור שלנו בגוף', candidates });
  const link = { ...found.link, payment_id: candidates.payment_id };
  const outcome = await syncPaymentLink(db, sumitProvider(), link);
  console.log(`[sumit-webhook] ${link.external_identifier}: ${outcome.result}`);
  // 200 תמיד כשעובד — כדי ש-SUMIT לא תשלח שוב ושוב; המצב האמיתי נבדק גם ב-cron.
  return json({ ok: true, ...outcome });
});
