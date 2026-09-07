// cron-sumit-sync — בדיקה יזומה מול SUMIT, כל שעה, על כל הקישורים הפתוחים.
//
// זה מה שמכסה הורה שסגרה את הדף באמצע, רשת שנפלה, או טריגר שלא הוגדר:
// התשלום נקלט גם בלי webhook. קישורים שפגו מסומנים expired.
import { adminClient } from '../_shared/supabase.ts';
import { requireCronSecret } from '../_shared/guard.ts';
import { sumitProvider } from '../_shared/sumit.ts';
import { syncPaymentLink } from '../_shared/sumit-sync.ts';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const db = adminClient();
  try {
    const { data: links, error } = await db.rpc('rpc_payment_links_to_sync');
    if (error) throw new Error(error.message);
    const sumit = sumitProvider();
    const counts: Record<string, number> = {};
    const tokens: string[] = [];
    for (const l of (links ?? []) as { token: string; external_identifier: string; amount: number }[]) {
      const o = await syncPaymentLink(db, sumit, l);
      counts[o.result] = (counts[o.result] ?? 0) + 1;
      tokens.push(l.token);
    }
    const { data: expired } = await db.rpc('rpc_payment_links_mark_checked', { p_tokens: tokens });
    console.log(`[cron-sumit-sync] ${tokens.length} נבדקו, ${JSON.stringify(counts)}, ${expired ?? 0} פגו`);
    return json({ checked: tokens.length, ...counts, expired: expired ?? 0 });
  } catch (e) {
    console.error('[cron-sumit-sync] נכשל', e);
    return json({ error: 'סנכרון SUMIT נכשל' }, 500);
  }
});
