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
export type StandingItem = { ID: number; Status: number | null; Date_NextBilling: string | null; Date_PreviousBilling: string | null };
export type StandingProvider = {
  create(input: CreateStandingInput): Promise<CreateStandingResult>;
  list(customerId: number): Promise<StandingItem[]>;
  cancel(customerId: number, recurringId: number): Promise<{ ok: true } | { ok: false; error: string }>;
  payments(from: string, to: string): Promise<SumitPayment[]>;
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

/** החיובים של הוראה אחת: של הלקוחה, מתאריך ההתחלה, בסכום של התשלום, שעוד לא נרשמו. */
export function chargesForOrder(payments: SumitPayment[], order: { customer_id: number; amount: number; date_start: string }): SumitPayment[] {
  const start = new Date(`${order.date_start}T00:00:00Z`).getTime() - 2 * 86400_000;   // סבולת שעון/אזור זמן
  return payments.filter((p) =>
    p.CustomerID != null && Number(p.CustomerID) === Number(order.customer_id)
    && Math.abs(Number(p.Amount) - Number(order.amount)) < 0.005
    && new Date(p.Date).getTime() >= start);
}

/** חלון החיפוש ב-payments/list לכל ההוראות בריצה אחת. */
export function paymentsWindow(orders: { date_start: string; last_checked_at: string | null }[], now = new Date()): { from: string; to: string } | null {
  if (orders.length === 0) return null;
  const d = (x: Date) => x.toISOString().slice(0, 10);
  const starts = orders.map((o) => {
    const base = o.last_checked_at ? new Date(o.last_checked_at).getTime() - 7 * 86400_000 : new Date(`${o.date_start}T00:00:00Z`).getTime() - 2 * 86400_000;
    return Math.max(base, new Date(`${o.date_start}T00:00:00Z`).getTime() - 2 * 86400_000);
  });
  return { from: d(new Date(Math.min(...starts))), to: d(new Date(now.getTime() + 86400_000)) };
}

// ─────────── הרצה יבשה ───────────
class DryRunStanding implements StandingProvider {
  static created = new Map<number, { customerId: number; status: number }>();
  static nextId = 9_000_000;
  create(input: CreateStandingInput): Promise<CreateStandingResult> {
    if (input.customerId === 0) return Promise.resolve({ ok: false, error: 'אין כרטיס שמור ללקוחה (מוקלט)', dryRun: true });
    const id = DryRunStanding.nextId++;
    DryRunStanding.created.set(id, { customerId: input.customerId, status: 0 });
    console.log(`[SUMIT_DRY_RUN] הוראת קבע ${id}: ${input.installments} × ${input.amount} ₪ מ-${input.dateStart}`);
    return Promise.resolve({ ok: true, recurringId: id, immediatePayment: null, dryRun: true });
  }
  list(customerId: number): Promise<StandingItem[]> {
    return Promise.resolve([...DryRunStanding.created.entries()].filter(([, v]) => v.customerId === customerId)
      .map(([id, v]) => ({ ID: id, Status: v.status, Date_NextBilling: null, Date_PreviousBilling: null })));
  }
  cancel(_customerId: number, recurringId: number): Promise<{ ok: true } | { ok: false; error: string }> {
    const r = DryRunStanding.created.get(recurringId);
    if (r) r.status = 1;
    return Promise.resolve({ ok: true });
  }
  payments(): Promise<SumitPayment[]> { return Promise.resolve([]); }
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
  async payments(from: string, to: string): Promise<SumitPayment[]> {
    const r = await this.post('/billing/payments/list/', { Date_From: from, Date_To: to });
    return (((r.Data ?? {}) as { Payments?: SumitPayment[] }).Payments ?? []);
  }
}

export function standingProvider(): StandingProvider {
  return SUMIT_DRY_RUN ? new DryRunStanding() : new RealStanding();
}
