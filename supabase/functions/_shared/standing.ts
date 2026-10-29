/**
 * הוראת קבע ב-SUMIT — אדפטר אחד, כמו sumit.ts: אמיתי או הרצה יבשה
 * (SUMIT_DRY_RUN). החוזה מהמפרט הרשמי של SUMIT (docs/sumit-swagger.json):
 *   POST /billing/recurring/charge/          — יצירה על הכרטיס השמור של הלקוחה
 *        (PaymentMethod ריק = "use the customer payment method"), Date_Start
 *        עתידי, Duration_Months 1, Recurrence = מספר החיובים.
 *        תשובה: Data.RecurringCustomerItemIDs, ו-Data.Payment אם חויב מיד.
 *   POST /billing/recurring/listforcustomer/ — Data.RecurringItems[]: ID, Status,
 *        Date_NextBilling, Date_PreviousBilling.
 *   POST /billing/recurring/cancel/          — Customer + RecurringCustomerItemID.
 *   POST /billing/recurring/update/          — שינוי יום חיוב: NextPaymentDate + Recurrence (= מספר
 *        החיובים שנותרו). אומת מול SUMIT (29/10/2026, הוראת הבדיקה): Date_NextBilling ו-Date_Last
 *        זזו לתאריך החדש, הסכום והסטטוס לא השתנו, Data ריק.
 *   POST /billing/payments/list/             — החיובים (כולל שנדחו), לפי תאריכים;
 *        מסננים לפי CustomerID אצלנו (המסנן בצד SUMIT לא עובד — אומת).
 * ★ לא אומת מול חיוב אמיתי: ש-Date_Start עתידי לא מחייב מיד. אם בכל זאת
 *   חויב — התשובה מכילה Payment, ונרשם כחיוב + התראה (לא נבלע).
 */
import { env } from './env.ts';
import { SUMIT_API_BASE, SUMIT_DRY_RUN, type SumitPayment } from './sumit.ts';

export type CreateStandingInput = {
  customerId: number; amount: number; installments: number; dateStart: string;   // YYYY-MM-DD
  itemName: string; description: string;
};
export type CreateStandingResult =
  | { ok: true; recurringId: number; immediatePayment: SumitPayment | null; dryRun: boolean }
  | { ok: false; error: string; dryRun: boolean };
/** Date_Last — מועד החיוב האחרון בהוראה (ממנו: כמה חיובים נותרו לפי SUMIT). */
export type StandingItem = { ID: number; Status: number | null; Date_NextBilling: string | null; Date_PreviousBilling: string | null; Date_Last?: string | null };
export type UpdateStandingInput = { customerId: number; recurringId: number; nextDate: string; remaining: number };   // nextDate: YYYY-MM-DD
export type StandingProvider = {
  create(input: CreateStandingInput): Promise<CreateStandingResult>;
  list(customerId: number): Promise<StandingItem[]>;
  cancel(customerId: number, recurringId: number): Promise<{ ok: true } | { ok: false; error: string }>;
  update(input: UpdateStandingInput): Promise<{ ok: true } | { ok: false; error: string }>;
  // ★ אין payments(): רשימת התשלומים של החשבון כוללת לקוחות אחרים (0036). חיובים מזוהים מ-list() של הלקוחה שלנו.
};

// ─────────── פונקציות טהורות (נבדקות) ───────────
export function recurringChargeBody(i: CreateStandingInput) {
  return {
    Customer: { ID: i.customerId },
    Items: [{
      Item: { Name: i.itemName, Duration_Months: 1 },
      Quantity: 1, UnitPrice: i.amount, Currency: 0,
      Date_Start: i.dateStart, Duration_Months: 1, Recurrence: i.installments,
      Description: i.description,
    }],
    VATIncluded: true,
    // הכרטיס השמור של הלקוחה: PaymentMethod לא נשלח בכלל. פרטי כרטיס לא עוברים דרכנו.
  };
}

/**
 * שינוי יום חיוב: התאריך הבא, ומספר החיובים שנותרו — כדי ש-SUMIT תחשב מחדש את האחרון.
 * בלי Recurrence התאריך האחרון היה עלול להישאר, ואז חיוב אחד היה נעלם (או נוסף).
 * הסכום לא נשלח — לא משתנה.
 */
export function recurringUpdateBody(i: UpdateStandingInput) {
  return { Customer: { ID: i.customerId }, RecurringCustomerItemID: i.recurringId, NextPaymentDate: i.nextDate, Recurrence: i.remaining };
}

/** YYYY-MM-DD + n חודשים (יום עד 28 — בלי גלישה לחודש הבא). */
export function addMonths(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y!, m! - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d!, last)).padStart(2, '0')}`;
}

// ─────────── הרצה יבשה ───────────
class DryRunStanding implements StandingProvider {
  static created = new Map<number, { customerId: number; status: number; next: string; last: string }>();
  static nextId = 9_000_000;
  create(input: CreateStandingInput): Promise<CreateStandingResult> {
    if (input.customerId === 0) return Promise.resolve({ ok: false, error: 'אין כרטיס שמור ללקוחה (מוקלט)', dryRun: true });
    const id = DryRunStanding.nextId++;
    DryRunStanding.created.set(id, { customerId: input.customerId, status: 0, next: input.dateStart, last: addMonths(input.dateStart, input.installments - 1) });
    console.log(`[SUMIT_DRY_RUN] הוראת קבע ${id}: ${input.installments} × ${input.amount} ₪ מ-${input.dateStart}`);
    return Promise.resolve({ ok: true, recurringId: id, immediatePayment: null, dryRun: true });
  }
  list(customerId: number): Promise<StandingItem[]> {
    return Promise.resolve([...DryRunStanding.created.entries()].filter(([, v]) => v.customerId === customerId)
      .map(([id, v]) => ({ ID: id, Status: v.status, Date_NextBilling: v.next, Date_PreviousBilling: null, Date_Last: v.last })));
  }
  cancel(_customerId: number, recurringId: number): Promise<{ ok: true } | { ok: false; error: string }> {
    const r = DryRunStanding.created.get(recurringId);
    if (r) r.status = 1;
    return Promise.resolve({ ok: true });
  }
  update(input: UpdateStandingInput): Promise<{ ok: true } | { ok: false; error: string }> {
    const r = DryRunStanding.created.get(input.recurringId);
    if (!r || r.customerId !== input.customerId) return Promise.resolve({ ok: false, error: 'ההוראה לא נמצאה (מוקלט)' });
    r.next = input.nextDate; r.last = addMonths(input.nextDate, input.remaining - 1);
    console.log(`[SUMIT_DRY_RUN] הוראת קבע ${input.recurringId}: החיוב הבא ${input.nextDate}, ${input.remaining} נותרו`);
    return Promise.resolve({ ok: true });
  }
}

// ─────────── SUMIT אמיתי ───────────
type Envelope = { Data: unknown; Status: number; UserErrorMessage: string | null; TechnicalErrorDetails: string | null };
class RealStanding implements StandingProvider {
  private async post(path: string, body: Record<string, unknown>): Promise<Envelope> {
    const companyId = env('SUMIT_COMPANY_ID'), apiKey = env('SUMIT_API_KEY');
    if (!companyId || !apiKey) throw new Error('חסרים SUMIT_COMPANY_ID / SUMIT_API_KEY');
    const res = await fetch(`${SUMIT_API_BASE}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ Credentials: { CompanyID: Number(companyId), APIKey: apiKey }, ...body }), redirect: 'manual',
    });
    if (res.status >= 300 && res.status < 400) throw new Error(`SUMIT: הנתיב ${path} אינו קיים (הפניה)`);
    const json = JSON.parse(await res.text()) as Envelope;
    if (json.Status !== 0) throw new Error(`SUMIT: ${json.UserErrorMessage ?? json.TechnicalErrorDetails ?? `Status ${json.Status}`}`);
    return json;
  }
  async create(input: CreateStandingInput): Promise<CreateStandingResult> {
    try {
      const r = await this.post('/billing/recurring/charge/', recurringChargeBody(input));
      const data = (r.Data ?? {}) as { RecurringCustomerItemIDs?: number[] | null; Payment?: SumitPayment | null };
      const id = data.RecurringCustomerItemIDs?.[0];
      if (!id) return { ok: false, error: 'SUMIT לא החזירה מזהה להוראת הקבע', dryRun: false };
      const p = data.Payment && Number(data.Payment.Amount) > 0 ? data.Payment : null;
      return { ok: true, recurringId: Number(id), immediatePayment: p, dryRun: false };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'שגיאה לא ידועה', dryRun: false }; }
  }
  async list(customerId: number): Promise<StandingItem[]> {
    const r = await this.post('/billing/recurring/listforcustomer/', { Customer: { ID: customerId }, IncludeInactive: true });
    return (((r.Data ?? {}) as { RecurringItems?: StandingItem[] | null }).RecurringItems ?? []);
  }
  async cancel(customerId: number, recurringId: number): Promise<{ ok: true } | { ok: false; error: string }> {
    try { await this.post('/billing/recurring/cancel/', { Customer: { ID: customerId }, RecurringCustomerItemID: recurringId }); return { ok: true }; }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'שגיאה לא ידועה' }; }
  }
  async update(input: UpdateStandingInput): Promise<{ ok: true } | { ok: false; error: string }> {
    try { await this.post('/billing/recurring/update/', recurringUpdateBody(input)); return { ok: true }; }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'שגיאה לא ידועה' }; }
  }
}

export function standingProvider(): StandingProvider {
  return SUMIT_DRY_RUN ? new DryRunStanding() : new RealStanding();
}
