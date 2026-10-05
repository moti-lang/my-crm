/**
 * הסנכרון של הוראות הקבע — רץ בתוך cron-sumit-sync, אחרי הקישורים:
 *  1. קישורים ששולמו עם אישור הוראת קבע → יוצרים את ההוראה ב-SUMIT.
 *  2. כל הוראה פעילה: המצב ב-SUMIT, והחיובים שנקלטו (תקין → תשלום; נדחה → התראה).
 * כל הכתיבה דרך RPC במסד (service_role). כאן רק השיחה עם SUMIT.
 */
import type { Db } from './sumit-sync.ts';
import { chargesForOrder, paymentsWindow, type StandingProvider } from './standing.ts';

type ToSetup = { link_id: string; student_name: string; branch: string; customer_id: number | null; amount: number; installments: number; installments_total: number; date_start: string };
type ToCheck = { id: string; customer_id: number; recurring_id: number; amount: number; date_start: string; last_checked_at: string | null; status: string };

export async function syncStandingOrders(db: Db, sumit: StandingProvider) {
  const out = { created: 0, setup_failed: 0, checked: 0, charges: 0, declined: 0, errors: 0 };

  // ─── 1. יצירה ───
  const { data: setup } = await db.rpc('rpc_standing_orders_to_setup');
  for (const s of (setup ?? []) as ToSetup[]) {
    if (!s.customer_id) {
      await db.rpc('rpc_standing_order_created', { p_link: s.link_id, p_ok: false, p_customer_id: 0, p_recurring_id: null,
        p_error: 'אין מזהה לקוחה מ-SUMIT לתשלום הראשון — אי אפשר לחייב את הכרטיס השמור' });
      out.setup_failed++; continue;
    }
    const r = await sumit.create({
      customerId: Number(s.customer_id), amount: Number(s.amount), installments: Number(s.installments), dateStart: s.date_start,
      itemName: `שכר לימוד — הוראת קבע (${s.branch})`,
      description: `${s.student_name} · ${s.installments} תשלומים חודשיים של ${s.amount} ₪`,
    });
    const { data: orderId } = await db.rpc('rpc_standing_order_created', {
      p_link: s.link_id, p_ok: r.ok, p_customer_id: Number(s.customer_id), p_recurring_id: r.ok ? r.recurringId : null, p_error: r.ok ? null : r.error,
    });
    if (!r.ok) { out.setup_failed++; continue; }
    out.created++;
    // ★ אם SUMIT חייבה מיד (לא אמור לקרות עם Date_Start עתידי) — הכסף נרשם, והבעלים יודעת.
    if (r.immediatePayment && orderId) {
      const p = r.immediatePayment;
      await db.rpc('rpc_record_standing_charge', { p_order: orderId, p_sumit_payment_id: Number(p.ID), p_amount: Number(p.Amount),
        p_charged_at: p.Date, p_valid: p.ValidPayment === true, p_document_url: null });
      await db.from('system_alerts').insert({ kind: 'standing_order_immediate_charge', severity: 'warning',
        title: 'SUMIT חייבה את הוראת הקבע כבר ביצירה',
        body: `${s.student_name}: חיוב של ${p.Amount} ₪ בוצע מיד ולא בתאריך ${s.date_start}. החיוב נרשם. לבדוק ב-SUMIT שמספר החיובים הנותרים נכון.`,
        meta: { link_id: s.link_id, sumit_payment_id: p.ID } });
    }
  }

  // ─── 2. בדיקה ───
  const { data: check } = await db.rpc('rpc_standing_orders_to_check');
  const orders = (check ?? []) as ToCheck[];
  const win = paymentsWindow(orders);
  const all = win ? await sumit.payments(win.from, win.to).catch(() => { out.errors++; return []; }) : [];
  for (const o of orders) {
    try {
      const items = await sumit.list(Number(o.customer_id));
      const item = items.find((i) => Number(i.ID) === Number(o.recurring_id));
      if (item) {
        await db.rpc('rpc_standing_order_status', { p_id: o.id, p_sumit_status: item.Status ?? null,
          p_next: item.Date_NextBilling?.slice(0, 10) ?? null, p_last: item.Date_PreviousBilling?.slice(0, 10) ?? null });
      }
      for (const p of chargesForOrder(all, o)) {
        const { data } = await db.rpc('rpc_record_standing_charge', { p_order: o.id, p_sumit_payment_id: Number(p.ID), p_amount: Number(p.Amount),
          p_charged_at: p.Date, p_valid: p.ValidPayment === true, p_document_url: null });
        const d = data as { duplicate?: boolean; valid?: boolean } | null;
        if (d && !d.duplicate) { if (d.valid) out.charges++; else out.declined++; }
      }
      out.checked++;
    } catch (e) {
      out.errors++;
      console.error('[standing-sync]', o.id, e);
    }
  }
  return out;
}
