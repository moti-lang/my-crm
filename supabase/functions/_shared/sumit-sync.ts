import type { SumitProvider } from './sumit.ts';

/**
 * הלב של הקליטה: לוקח קישור, שואל את SUMIT, ורושם אצלנו רק מה ש-SUMIT
 * אישרה. מוזרק db וספק, כמו customer.ts, כדי שבדיקה תריץ אותו מול מסד
 * מזויף ותתעד כל כתיבה.
 *
 * ★ הרישום (rpc_record_sumit_payment) אידמפוטנטי — webhook + cron + הודעה
 *   כפולה נרשמים פעם אחת. ★ SUMIT אומרת "שולם" והרישום נכשל → התראה.
 */
export type Db = { rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: any; error: { message: string } | null }>; from: (t: string) => any };

export type SyncOutcome =
  | { result: 'recorded'; duplicate: boolean; status: string }
  | { result: 'unpaid' | 'not_found' }
  | { result: 'provider_error'; error: string }
  | { result: 'record_failed'; error: string };

export async function syncPaymentLink(db: Db, sumit: SumitProvider, link: { external_identifier: string; amount: number }): Promise<SyncOutcome> {
  const status = await sumit.getPaymentStatus(link.external_identifier);
  if (!status.ok) return { result: 'provider_error', error: status.error };
  if (!status.found) return { result: 'not_found' };
  if (!status.paid) return { result: 'unpaid' };

  const { data, error } = await db.rpc('rpc_record_sumit_payment', {
    p_external_identifier: link.external_identifier,
    p_sumit_payment_id: status.paymentId,
    p_amount: status.amount,
    p_paid_at: status.paidAt,
    p_document_id: status.documentId,
  });
  if (error || !data?.ok) {
    const detail = error?.message ?? data?.reason ?? 'לא ידוע';
    await db.from('system_alerts').insert({
      kind: 'sumit_record_failed', severity: 'critical',
      title: 'תשלום נקלט ב-SUMIT ולא נרשם אצלנו',
      body: `${link.external_identifier}: SUMIT מדווחת תשלום ${status.paymentId} של ${status.amount} ₪, והרישום נכשל: ${detail}. לבדוק במסך ההתאמה.`,
      meta: { external_identifier: link.external_identifier, sumit_payment_id: status.paymentId, amount: status.amount },
    });
    return { result: 'record_failed', error: detail };
  }
  return { result: 'recorded', duplicate: data.duplicate === true, status: String(data.status ?? '') };
}
