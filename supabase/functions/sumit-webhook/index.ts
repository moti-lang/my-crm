// sumit-webhook — טריגר מ-SUMIT אחרי תשלום. **רמז בלבד.**
//
// SUMIT לא חותמת: הכניסה מוגנת בסוד משותף בכותרת x-webhook-secret
// (השוואה בזמן קבוע). מהגוף נלקח רק ה-ExternalIdentifier שלנו, ואז
// שואלים את SUMIT מה באמת קרה (syncPaymentLink). גוף מזויף עם "שולם"
// לא רושם כלום — כי הרישום קורה רק אחרי תשובת SUMIT.
import { adminClient } from '../_shared/supabase.ts';
import { requireSharedSecret } from '../_shared/guard.ts';
import { sumitProvider, extractExternalIdentifier } from '../_shared/sumit.ts';
import { syncPaymentLink } from '../_shared/sumit-sync.ts';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  const denied = await requireSharedSecret(req, 'SUMIT_WEBHOOK_SECRET');
  if (denied) return denied;

  const raw = await req.text();
  const ext = extractExternalIdentifier(req.headers.get('content-type') ?? '', raw);
  if (!ext) return json({ ok: true, ignored: 'אין ExternalIdentifier שלנו בגוף' });

  const db = adminClient();
  const { data: links, error } = await db.rpc('rpc_payment_links_to_sync');
  if (error) return json({ ok: false, error: 'DB' }, 500);
  const link = ((links ?? []) as { external_identifier: string; amount: number }[]).find((l) => l.external_identifier === ext)
    ?? { external_identifier: ext, amount: 0 };
  const outcome = await syncPaymentLink(db, sumitProvider(), link);
  console.log(`[sumit-webhook] ${ext}: ${outcome.result}`);
  // 200 תמיד כשעובד — כדי ש-SUMIT לא תשלח שוב ושוב; המצב האמיתי נבדק גם ב-cron.
  return json({ ok: true, ...outcome });
});
