// sumit-checkout — ההורה לחצה "לתשלום" בדף /pay/<טוקן>.
//
// יוצרת את דף SUMIT **עכשיו**, עם הסכום מהרשומה שלנו (לא מהדפדפן), שומרת
// את הכתובת, ומחזירה אותה. קישור שפג או בוטל — מסרב. הקריאה חוזרת על
// עצמה בטוח: דף שכבר נוצר מוחזר שוב.
import { adminClient } from '../_shared/supabase.ts';
import { preflight, withCors } from '../_shared/cors.ts';
import { requirePayToken } from '../_shared/guard.ts';
import { sumitProvider, checkoutOpenFor, CHECKOUT_CLOSED_MESSAGE, type LinkRef } from '../_shared/sumit.ts';
import { syncPaymentLink, type Db } from '../_shared/sumit-sync.ts';
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
  // ★ החזרה מ-SUMIT אחרי תשלום: OG-PaymentID / OG-CustomerID / OG-ExternalIdentifier.
  //   מאמתים את התשלום הזה בלבד (ראה getPaymentStatus) — לא "שולם" מהדפדפן.
  if (new URL(req.url).searchParams.get('confirm') === '1') return await confirm(db as unknown as Db, token, new URL(req.url).searchParams);
  try {
    // קודם מה שיש: אם כבר נוצר דף — מחזירים אותו.
    const { data: link, error } = await db.rpc('rpc_payment_link_set_page', { p_token: token, p_url: null });
    if (error) throw new Error(error.message);
    if (!link?.ok) return json({ ok: false, error: link?.error ?? 'הקישור לא תקף' }, 410);
    if (link.sumit_page_url) return json({ ok: true, url: link.sumit_page_url });
    // ★ הוראת קבע: בלי אישור מפורש של ההורה (התיבה בדף) — אין דף תשלום.
    //   האישור נשמר במסד בנוסח המדויק שהוצג, לפני כל פנייה ל-SUMIT.
    const { data: needsConsent, error: cErr } = await db.rpc('rpc_standing_consent_required', { p_token: token });
    if (cErr) throw new Error(cErr.message);
    if (needsConsent) {
      if (new URL(req.url).searchParams.get('consent') !== '1') {
        return json({ ok: false, consent_required: true, error: 'יש לאשר את הוראת הקבע לפני התשלום' }, 409);
      }
      const { data: c, error: sErr } = await db.rpc('rpc_standing_consent', { p_token: token });
      if (sErr || !c?.ok) throw new Error(sErr?.message ?? 'שמירת האישור נכשלה');
    }

    // שער ההשקה — לפני כל פנייה ל-SUMIT (ראה checkoutOpenFor).
    if (!checkoutOpenFor(token, env('SUMIT_CHECKOUT_ALLOW_TOKEN'))) return json({ ok: false, error: CHECKOUT_CLOSED_MESSAGE }, 503);

    const base = env('APP_BASE_URL') ?? 'https://teichtal-crm.netlify.app';
    const { data: program } = await db.rpc('rpc_payment_link_program', { p_token: token });
    const page = await sumitProvider().createPaymentPage({
      externalIdentifier: link.external_identifier,
      amount: Number(link.amount),
      // שם החוג של הסניף מופיע בדף התשלום ובקבלה. ריק → בלי שם.
      description: `שכר לימוד${program ? ` ${program}` : ''} — ${link.student_name} (${link.branch})`,
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

/**
 * אישור תשלום מהחזרה של SUMIT. המזהים מגיעים מהדפדפן, ולכן: רק עם ה-ExternalIdentifier
 * של הקישור, עד 3 מזהים שונים לקישור (rpc_payment_link_candidate), ואימות מלא מול SUMIT
 * של התשלום הזה בלבד. הקבלה נוצרת שניות אחרי התשלום — עד 3 בדיקות, 4 שניות ביניהן.
 */
async function confirm(db: Db, token: string, q: URLSearchParams): Promise<Response> {
  const pid = q.get('pid'), cid = q.get('cid') || null, ext = q.get('ext');
  const { data, error } = await db.rpc('rpc_payment_link_candidate', { p_token: token, p_external_identifier: ext, p_payment_id: pid, p_customer_id: cid, p_source: 'redirect' });
  if (error) return json({ ok: false, error: 'שגיאה בשמירת האישור' }, 500);
  const r = data as { ok: boolean; error?: string; already_paid?: boolean; link?: LinkRef };
  if (!r.ok) return json({ ok: false, error: r.error }, 400);
  if (r.already_paid || !r.link) return json({ ok: true, result: 'paid' });
  let outcome = await syncPaymentLink(db, sumitProvider(), r.link);
  for (let i = 0; i < 2 && outcome.result === 'pending'; i++) {
    await new Promise((res) => setTimeout(res, 4000));
    outcome = await syncPaymentLink(db, sumitProvider(), r.link);
  }
  return json({ ok: true, result: outcome.result });
}
