import type { StandingProvider } from './standing.ts';

/**
 * "שינוי יום חיוב" בהוראת קבע (הבעלים). כאן ולא בתוך הפונקציה, כדי שבדיקת הדפדפן תריץ בדיוק את הקוד הזה.
 *
 *  1. התוכנית — במסד, בהרשאות המשתמשת (rpc_standing_reschedule_preview: בעלים בלבד, וכל הכללים).
 *  2. המצב העדכני מ-SUMIT (קריאה 1): חיוב שקרה בינתיים או שינוי ידני שם — נקלטים קודם
 *     (rpc_standing_billing_observed), כמו בסנכרון.
 *  3. ★ מספר החיובים שנותרו לפי SUMIT = לפי המערכת. אחרת לא נוגעים (Recurrence שגוי = חיוב חסר או עודף).
 *  4. התוכנית שוב, על המצב העדכני. ★ יצא תאריך אחר ממה שהבעלים ראתה — לא משנים; מחזירים את החדש לאישור.
 *  5. העדכון ב-SUMIT (קריאה 2). ★ רק אם SUMIT אישרה — התאריך אצלנו + יומן (מי, מתי, מאיזה תאריך לאיזה).
 */
type Res = { data: unknown; error: { message: string } | null };
type UserDb = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<Res> };
type AdminDb = UserDb & {
  from: (table: string) => { select: (cols: string) => { eq: (col: string, v: string) => { maybeSingle: () => PromiseLike<Res> } } };
};

export type ReschedulePlan = {
  ok: true; next: string; final: string; remaining: number; day: number; from: string; from_day: number;
  kind: 'charged_this_month' | 'day_ahead' | 'day_passed'; current: string; reason: string; sentence: string;
};
export type RescheduleOutcome = { status: number; body:
  | { ok: true; plan: ReschedulePlan }
  | { ok: false; error: string; changed?: boolean; plan?: ReschedulePlan } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): RescheduleOutcome => ({ status, body: { ok: false, error, ...extra } });

export async function rescheduleStanding(user: UserDb, admin: AdminDb, sumit: StandingProvider,
                                         input: { id?: unknown; day?: unknown; expected?: unknown }, by: string | null): Promise<RescheduleOutcome> {
  const id = String(input.id ?? ''), day = Number(input.day), expected = String(input.expected ?? '');
  if (!UUID.test(id)) return fail(400, 'מזהה לא תקין');
  if (!Number.isInteger(day) || day < 1 || day > 28) return fail(400, 'יום החיוב: בין 1 ל-28 בחודש');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expected)) return fail(400, 'חסר התאריך שהוצג לאישור');

  const preview = async () => {
    const { data, error } = await user.rpc('rpc_standing_reschedule_preview', { p_id: id, p_day: day });
    if (error) return { denied: error.message } as const;
    return { plan: data as ReschedulePlan | { ok: false; error: string } } as const;
  };
  const first = await preview();
  if ('denied' in first) return fail(403, first.denied ?? 'אין הרשאה');
  if (!first.plan.ok) return fail(409, first.plan.error);

  const { data: row } = await admin.from('standing_orders').select('sumit_customer_id, sumit_recurring_id').eq('id', id).maybeSingle();
  const ids = row as { sumit_customer_id: number; sumit_recurring_id: number } | null;
  if (!ids?.sumit_recurring_id) return fail(409, 'להוראה הזו אין מזהה ב-SUMIT');

  let items;
  try { items = await sumit.list(Number(ids.sumit_customer_id)); }
  catch (e) { return fail(502, `לא הצלחנו לבדוק את ההוראה מול SUMIT (${e instanceof Error ? e.message : 'שגיאה'}). לא שיניתי כלום.`); }
  const item = items.find((i) => Number(i.ID) === Number(ids.sumit_recurring_id));
  if (!item) return fail(502, 'ההוראה לא נמצאה ב-SUMIT אצל הלקוחה הזו. לא שיניתי כלום.');

  const { data: obs, error: obsErr } = await admin.rpc('rpc_standing_billing_observed', {
    p_id: id, p_sumit_status: item.Status ?? null, p_next: item.Date_NextBilling?.slice(0, 10) ?? null,
    p_prev: item.Date_PreviousBilling?.slice(0, 10) ?? null, p_final: item.Date_Last?.slice(0, 10) ?? null });
  if (obsErr) return fail(500, 'לא הצלחנו לעדכן את המצב מ-SUMIT. לא שיניתי כלום.');
  const o = obs as { remaining_ok: boolean | null; remaining: number; sumit_remaining: number | null };
  if (o.remaining_ok !== true) {
    return fail(409, o.sumit_remaining == null
      ? 'SUMIT לא החזירה את מועד החיוב האחרון, ואי אפשר לוודא כמה חיובים נותרו. לא שיניתי כלום.'
      : `לפי SUMIT נותרו ${o.sumit_remaining} חיובים, ולפי המערכת ${o.remaining}. לא שיניתי כלום — כדאי לבדוק ב-SUMIT.`);
  }

  const again = await preview();
  if ('denied' in again) return fail(403, again.denied ?? 'אין הרשאה');
  if (!again.plan.ok) return fail(409, again.plan.error);
  const plan = again.plan;
  if (plan.next !== expected) {
    return fail(409, 'המצב ב-SUMIT השתנה מאז שנפתח החלון (למשל חיוב שנקלט עכשיו). זה התאריך המעודכן — לבדוק ולאשר שוב.', { changed: true, plan });
  }

  const r = await sumit.update({ customerId: Number(ids.sumit_customer_id), recurringId: Number(ids.sumit_recurring_id), nextDate: plan.next, remaining: plan.remaining });
  if (!r.ok) return fail(502, `SUMIT לא שינתה את התאריך: ${r.error}. שום דבר לא השתנה.`);

  const { error: mErr } = await admin.rpc('rpc_standing_order_rescheduled', {
    p_id: id, p_by: by, p_from: plan.from, p_to: plan.next, p_day: plan.day, p_remaining: plan.remaining });
  if (mErr) return fail(500, 'התאריך שונה ב-SUMIT, אבל הרישום אצלנו נכשל. הסנכרון יקלוט את התאריך החדש.');
  return { status: 200, body: { ok: true, plan } };
}
