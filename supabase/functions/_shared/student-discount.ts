import type { StandingProvider } from './standing.ts';

/**
 * הנחה לתלמידה (הבעלים). כאן ולא בתוך הפונקציה, כדי שבדיקת הדפדפן תריץ בדיוק את הקוד הזה.
 *
 *  1. התוכנית — במסד, בהרשאות המשתמשת (rpc_discount_preview: בעלים בלבד, וכל הכללים).
 *     ★ ההנחה שתישמר חייבת להיות זו שהבעלים ראתה (expected) — אחרת לא שומרים.
 *  2. בלי הוראת קבע פעילה — שמירה במסד (rpc_discount_apply): החוב, המסלול, קישורים פתוחים.
 *  3. עם הוראת קבע פעילה — הסכום החודשי משתנה ב-SUMIT קודם:
 *     בדיקה (קריאה 1) → קליטת המצב → ★ כמה נותרו לפי SUMIT = לפי המערכת → התוכנית שוב →
 *     עדכון (קריאה 2: אותו תאריך, אותו מספר חיובים, סכום חדש) → ★ אימות (קריאה 3): הסכום החדש,
 *     והתאריך ומספר החיובים לא זזו → רק אז אצלנו + יומן. SUMIT עדכנה אחרת — התראה, ולא נשמר.
 */
type Res = { data: unknown; error: { message: string } | null };
type UserDb = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<Res> };
type AdminDb = UserDb & {
  from: (table: string) => any;   // eslint-disable-line @typescript-eslint/no-explicit-any
};

export type DiscountPlan = {
  ok: true; stage: 'standing' | 'link' | 'none'; requested: number; discount_before: number; discount_after: number;
  tuition_after: number; balance_after: number; lines: string[]; amount: number; kind: 'ils' | 'percent'; value: number;
  standing: { id: string; from_monthly: number; to_monthly: number; remaining: number; cut: number; next: string } | null;
  links: { id: string; purpose: string; from: number; to: number; action: 'update' | 'cancel' }[];
};
export type DiscountOutcome = { status: number; body:
  | { ok: true; plan: DiscountPlan }
  | { ok: false; error: string; changed?: boolean; plan?: DiscountPlan } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): DiscountOutcome => ({ status, body: { ok: false, error, ...extra } });
const day = (s: string | null | undefined) => (s ?? '').slice(0, 10);

export async function applyStudentDiscount(user: UserDb, admin: AdminDb, sumit: StandingProvider,
  input: { student?: unknown; kind?: unknown; value?: unknown; reason?: unknown; expected?: unknown }, by: string | null): Promise<DiscountOutcome> {
  const student = String(input.student ?? ''), kind = String(input.kind ?? ''), value = Number(input.value);
  const reason = String(input.reason ?? '').trim(), expected = Number(input.expected);
  if (!UUID.test(student)) return fail(400, 'מזהה לא תקין');
  if (kind !== 'ils' && kind !== 'percent') return fail(400, 'סוג הנחה לא מוכר');
  if (!Number.isFinite(value) || !Number.isFinite(expected)) return fail(400, 'חסר סכום ההנחה שהוצג לאישור');
  if (!reason) return fail(400, 'יש לכתוב סיבה להנחה');

  const preview = async () => {
    const { data, error } = await user.rpc('rpc_discount_preview', { p_student: student, p_kind: kind, p_value: value });
    if (error) return { denied: error.message } as const;
    return { plan: data as DiscountPlan | { ok: false; error: string } } as const;
  };
  const first = await preview();
  if ('denied' in first) return fail(403, first.denied ?? 'אין הרשאה');
  if (!first.plan.ok) return fail(409, first.plan.error);
  if (first.plan.discount_after !== expected) {
    return fail(409, 'המצב השתנה מאז שנפתח החלון — לבדוק ולאשר שוב.', { changed: true, plan: first.plan });
  }

  const apply = async (plan: DiscountPlan, toMonthly: number | null) => {
    const { data, error } = await admin.rpc('rpc_discount_apply', { p_student: student, p_amount: plan.amount, p_reason: reason, p_by: by,
      p_expected: plan.discount_after, p_to_monthly: toMonthly });
    if (error) return fail(500, 'השמירה נכשלה');
    const r = data as DiscountPlan | { ok: false; error: string; changed?: boolean; plan?: DiscountPlan };
    if (!r.ok) return fail(409, r.error, 'changed' in r && r.changed ? { changed: true, plan: r.plan } : {});
    return { status: 200, body: { ok: true as const, plan: { ...plan, ...r } } };
  };
  if (first.plan.stage !== 'standing' || !first.plan.standing) return apply(first.plan, null);

  // ─── הוראת קבע פעילה: SUMIT קודם ───
  const { data: row } = await admin.from('standing_orders').select('sumit_customer_id, sumit_recurring_id').eq('id', first.plan.standing.id).maybeSingle();
  const ids = row as { sumit_customer_id: number; sumit_recurring_id: number } | null;
  if (!ids?.sumit_recurring_id) return fail(409, 'להוראה אין מזהה ב-SUMIT');
  const fetchItem = async () => (await sumit.list(Number(ids.sumit_customer_id))).find((i) => Number(i.ID) === Number(ids.sumit_recurring_id)) ?? null;
  let item;
  try { item = await fetchItem(); }
  catch (e) { return fail(502, `לא הצלחנו לבדוק את ההוראה מול SUMIT (${e instanceof Error ? e.message : 'שגיאה'}). לא שיניתי כלום.`); }
  if (!item) return fail(502, 'ההוראה לא נמצאה ב-SUMIT אצל הלקוחה הזו. לא שיניתי כלום.');

  const { data: obs, error: obsErr } = await admin.rpc('rpc_standing_billing_observed', {
    p_id: first.plan.standing.id, p_sumit_status: item.Status ?? null, p_next: day(item.Date_NextBilling) || null,
    p_prev: day(item.Date_PreviousBilling) || null, p_final: day(item.Date_Last) || null });
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
  if (plan.stage !== 'standing' || !plan.standing || plan.discount_after !== expected || plan.standing.to_monthly !== first.plan.standing.to_monthly) {
    return fail(409, 'המצב ב-SUMIT השתנה מאז שנפתח החלון (למשל חיוב שנקלט עכשיו). זו התוכנית המעודכנת — לבדוק ולאשר שוב.', { changed: true, plan });
  }

  const st = plan.standing;
  const r = await sumit.update({ customerId: Number(ids.sumit_customer_id), recurringId: Number(ids.sumit_recurring_id),
    nextDate: st.next, remaining: st.remaining, unitPrice: st.to_monthly });
  if (!r.ok) return fail(502, `SUMIT לא עדכנה את הסכום: ${r.error}. שום דבר לא השתנה.`);

  // ★ אימות: הסכום החדש, והתאריך ומספר החיובים כמו שהיו.
  let after;
  try { after = await fetchItem(); } catch { after = null; }
  const ok = after && Number(after.UnitPrice) === st.to_monthly && day(after.Date_NextBilling) === day(item.Date_NextBilling)
    && day(after.Date_Last) === day(item.Date_Last);
  if (!ok) {
    await admin.from('system_alerts').insert({ kind: 'standing_order_discount_mismatch', severity: 'critical',
      title: 'עדכון הנחה בהוראת קבע — SUMIT לא מאשרת את מה שנשלח',
      body: `נשלח סכום ${st.to_monthly} ₪ מ-${st.next} ל-${st.remaining} חיובים, אבל SUMIT מחזירה: סכום ${after?.UnitPrice ?? '—'}, הבא ${day(after?.Date_NextBilling) || '—'}, אחרון ${day(after?.Date_Last) || '—'}. ההנחה לא נשמרה במערכת. לבדוק ב-SUMIT.`,
      meta: { standing_order_id: st.id, student_id: student } });
    return fail(502, 'SUMIT לא מאשרת את העדכון כמו שנשלח. ההנחה לא נשמרה במערכת, ונשלחה התראה — לבדוק ב-SUMIT.');
  }
  return apply(plan, st.to_monthly);
}
