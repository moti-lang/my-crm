// sumit-checkout — ההורה לחצה "לתשלום" בדף /pay/<טוקן>.
//
// יוצרת את דף SUMIT **עכשיו**, עם הסכום מהרשומה שלנו (לא מהדפדפן), שומרת
// את הכתובת, ומחזירה אותה. קישור שפג או בוטל — מסרב. הקריאה חוזרת על
// עצמה בטוח: דף שכבר נוצר מוחזר שוב.
import { adminClient } from '../_shared/supabase.ts';
import { preflight, withCors } from '../_shared/cors.ts';
import { requirePayToken } from '../_shared/guard.ts';
import { sumitProvider } from '../_shared/sumit.ts';
import { env } from '../_shared/env.ts';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  return withCors(req, await handle(req));
});

async function handle(req: Request): Promise<Response> {
  const denied = requirePayToken(req);
  if (denied) return denied;

  const token = new URL(req.url).searchParams.get('token') as string;
  const db = adminClient();
  try {
    // קודם מה שיש: אם כבר נוצר דף — מחזירים אותו.
    const { data: link, error } = await db.rpc('rpc_payment_link_set_page', { p_token: token, p_url: null });
    if (error) throw new Error(error.message);
    if (!link?.ok) return json({ ok: false, error: link?.error ?? 'הקישור לא תקף' }, 410);
    if (link.sumit_page_url) return json({ ok: true, url: link.sumit_page_url });

    const base = env('APP_BASE_URL') ?? 'https://teichtal-crm.netlify.app';
    const page = await sumitProvider().createPaymentPage({
      externalIdentifier: link.external_identifier,
      amount: Number(link.amount),
      description: `שכר לימוד — ${link.student_name} (${link.branch})`,
      customerName: link.student_name,
      customerPhone: link.parent_phone ?? null,
      redirectUrl: `${base}/pay/${token}?returned=1`,
    });
    if (!page.ok) {
      await db.from('system_alerts').insert({
        kind: 'sumit_page_failed', severity: 'warning', title: 'יצירת דף תשלום ב-SUMIT נכשלה',
        body: `${link.student_name}: ${page.error}`, meta: { external_identifier: link.external_identifier },
      });
      return json({ ok: false, error: 'לא הצלחנו לפתוח את דף התשלום כרגע. נסי שוב בעוד כמה דקות.' }, 502);
    }
    const { error: saveErr } = await db.rpc('rpc_payment_link_set_page', { p_token: token, p_url: page.url });
    if (saveErr) throw new Error(saveErr.message);
    return json({ ok: true, url: page.url, dryRun: page.dryRun });
  } catch (e) {
    console.error('[sumit-checkout]', e);
    return json({ ok: false, error: 'משהו השתבש. נסי שוב.' }, 500);
  }
}
