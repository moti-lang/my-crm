import { env } from './env.ts';

/**
 * האדפטר ל-SUMIT (sumit.co.il) — הגבייה בכרטיס. כמו ספק הוואטסאפ: ממשק
 * אחד, שני מימושים (הרצה יבשה / אמיתי), ואף אחד מהם לא נוגע במסד.
 *
 * ⚠️ המימוש האמיתי הוא שלד: הכתובת ליצירת דף תשלום ידועה מהחברה
 *   (/billing/payments/beginredirect/, דורש מודול "דפי תשלום"); שמות
 *   השדות המדויקים והקריאה לסטטוס בבירור מולם. כשיגיעו — ההחלפה כאן בלבד.
 *
 * ★ הכלל שהאדפטר משרת: אישור תשלום מגיע רק מ-SUMIT — getPaymentStatus —
 *   לעולם לא מהדפדפן ולא מגוף ה-webhook לבדו.
 */

export const SUMIT_DRY_RUN = (Deno.env.get('SUMIT_DRY_RUN') ?? 'true') !== 'false';
export const SUMIT_API_BASE = 'https://api.sumit.co.il';

export type CreatePageInput = {
  externalIdentifier: string;
  amount: number;
  description: string;
  customerName: string;
  customerPhone: string | null;
  /** לאן SUMIT מחזירה את ההורה אחרי התשלום — דף "תודה, בודקים", לא אישור. */
  redirectUrl: string;
};
export type CreatePageResult =
  | { ok: true; url: string; dryRun: boolean }
  | { ok: false; error: string; dryRun: boolean };

export type PaymentStatus =
  | { ok: true; found: false; dryRun: boolean }
  | { ok: true; found: true; paid: boolean; amount: number; paymentId: string; documentId: string | null; paidAt: string | null; dryRun: boolean }
  | { ok: false; error: string; dryRun: boolean };

export interface SumitProvider {
  createPaymentPage(input: CreatePageInput): Promise<CreatePageResult>;
  /** מקור האמת. לפי ה-ExternalIdentifier שלנו. */
  getPaymentStatus(externalIdentifier: string): Promise<PaymentStatus>;
}

// ─────────────────────────── הרצה יבשה ───────────────────────────
// תשובות מוקלטות לפי ה-ExternalIdentifier, כדי שבדיקה תוכל לביים כל מצב:
//   *-paid      → שולם במלואו (הסכום שהתבקש)
//   *-partial   → שולם 50 פחות
//   *-unpaid    → קיים, לא שולם
//   *-sumit-down→ שגיאת ספק
//   אחרת        → לא נמצא (עדיין לא שולם / הדף לא נפתח)
export const DRY_RUN_PAGE_URL = 'https://pay.sumit.co.il/dry-run/';

class DryRunSumitProvider implements SumitProvider {
  /** סכומים שנוצרו בדף — כדי ש"שולם" יחזיר את הסכום הנכון. */
  static amounts = new Map<string, number>();
  async createPaymentPage(input: CreatePageInput): Promise<CreatePageResult> {
    DryRunSumitProvider.amounts.set(input.externalIdentifier, input.amount);
    console.log(`[SUMIT_DRY_RUN] דף תשלום: ${input.externalIdentifier} · ${input.amount} ₪ · ${input.customerName}`);
    return await Promise.resolve({ ok: true, url: `${DRY_RUN_PAGE_URL}${encodeURIComponent(input.externalIdentifier)}`, dryRun: true });
  }
  async getPaymentStatus(externalIdentifier: string): Promise<PaymentStatus> {
    const amount = DryRunSumitProvider.amounts.get(externalIdentifier) ?? Number(externalIdentifier.match(/amount=(\d+(?:\.\d+)?)/)?.[1] ?? 0);
    const id = `dry-${externalIdentifier}`;
    if (externalIdentifier.endsWith('-sumit-down')) return await Promise.resolve({ ok: false, error: 'SUMIT לא זמינה (מוקלט)', dryRun: true });
    if (externalIdentifier.endsWith('-paid')) return await Promise.resolve({ ok: true, found: true, paid: true, amount, paymentId: id, documentId: `doc-${id}`, paidAt: new Date().toISOString(), dryRun: true });
    if (externalIdentifier.endsWith('-partial')) return await Promise.resolve({ ok: true, found: true, paid: true, amount: Math.max(0, amount - 50), paymentId: id, documentId: `doc-${id}`, paidAt: new Date().toISOString(), dryRun: true });
    if (externalIdentifier.endsWith('-unpaid')) return await Promise.resolve({ ok: true, found: true, paid: false, amount, paymentId: id, documentId: null, paidAt: null, dryRun: true });
    return await Promise.resolve({ ok: true, found: false, dryRun: true });
  }
}

// ─────────────────────────── SUMIT אמיתי (שלד) ───────────────────────────
class RealSumitProvider implements SumitProvider {
  private credentials() {
    const companyId = env('SUMIT_COMPANY_ID'), apiKey = env('SUMIT_API_KEY');
    if (!companyId || !apiKey) throw new Error('חסרים SUMIT_COMPANY_ID / SUMIT_API_KEY');
    return { CompanyID: Number(companyId), APIKey: apiKey };
  }
  private async post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch(`${SUMIT_API_BASE}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ Credentials: this.credentials(), ...body }),
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(text); } catch { throw new Error(`SUMIT החזירה תשובה שאינה JSON (HTTP ${res.status})`); }
    if (!res.ok || json.Status !== 0 && json.Status !== undefined && json.Status !== 'Success') {
      throw new Error(`SUMIT: ${String(json.UserErrorMessage ?? json.TechnicalErrorDetails ?? `HTTP ${res.status}`)}`);
    }
    return json;
  }
  async createPaymentPage(input: CreatePageInput): Promise<CreatePageResult> {
    try {
      // ⚠️ שמות השדות — לפי ה-swagger של SUMIT כשיתקבל. המבנה לפי הספריות הפתוחות.
      const json = await this.post('/billing/payments/beginredirect/', {
        Customer: { Name: input.customerName, Phone: input.customerPhone ?? undefined, ExternalIdentifier: input.externalIdentifier, SearchMode: 0 },
        Items: [{ Item: { Name: input.description }, Quantity: 1, UnitPrice: input.amount, TotalPrice: input.amount, Currency: 'ILS' }],
        ExternalIdentifier: input.externalIdentifier,
        RedirectURL: input.redirectUrl,
        Language: 0,
        VATIncluded: true,
      });
      const data = (json.Data ?? json) as Record<string, unknown>;
      const url = String(data.RedirectURL ?? data.URL ?? data.PaymentPageURL ?? '');
      if (!url) return { ok: false, error: 'SUMIT לא החזירה כתובת דף תשלום', dryRun: false };
      return { ok: true, url, dryRun: false };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'שגיאה לא ידועה', dryRun: false };
    }
  }
  async getPaymentStatus(externalIdentifier: string): Promise<PaymentStatus> {
    try {
      // ⚠️ הקריאה לסטטוס לפי ExternalIdentifier — בבירור מול SUMIT. עד אז: לא נמצא.
      const json = await this.post('/billing/payments/list/', { ExternalIdentifier: externalIdentifier });
      const list = ((json.Data as Record<string, unknown>)?.Payments ?? json.Payments ?? []) as Record<string, unknown>[];
      const p = list.find((x) => String(x.ExternalIdentifier ?? '') === externalIdentifier);
      if (!p) return { ok: true, found: false, dryRun: false };
      return {
        ok: true, found: true,
        paid: p.ValidPayment === true || p.Status === '000' || p.Status === 0,
        amount: Number(p.Amount ?? p.TotalPrice ?? 0),
        paymentId: String(p.ID ?? p.PaymentID ?? ''),
        documentId: p.DocumentID ? String(p.DocumentID) : null,
        paidAt: p.Date ? String(p.Date) : null,
        dryRun: false,
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'שגיאה לא ידועה', dryRun: false };
    }
  }
}

export function sumitProvider(): SumitProvider {
  return SUMIT_DRY_RUN ? new DryRunSumitProvider() : new RealSumitProvider();
}

// ─────────────────────────── ה-webhook (טריגר של SUMIT) ───────────────────────────
/**
 * גוף הטריגר של SUMIT מגיע בשלוש צורות: JSON, טופס (x-www-form-urlencoded),
 * או מעטפת json=<מחרוזת>. מוציאים ממנו רק רמז: ה-ExternalIdentifier שלנו.
 * הכול אחר כך מאומת מול SUMIT בקריאה יזומה.
 */
export function extractExternalIdentifier(contentType: string, rawBody: string): string | null {
  let obj: unknown = null;
  const ct = contentType.toLowerCase();
  try {
    if (ct.includes('application/json')) obj = JSON.parse(rawBody);
    else {
      const params = new URLSearchParams(rawBody);
      const envelope = params.get('json');
      if (envelope) obj = JSON.parse(envelope);
      else obj = Object.fromEntries(params.entries());
    }
  } catch { return null; }
  return findExternalIdentifier(obj, 0);
}

function findExternalIdentifier(v: unknown, depth: number): string | null {
  if (depth > 6 || v === null || typeof v !== 'object') return null;
  if (Array.isArray(v)) { for (const x of v) { const r = findExternalIdentifier(x, depth + 1); if (r) return r; } return null; }
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (/^external.?identifier$/i.test(k)) {
      const val = Array.isArray(o[k]) ? (o[k] as unknown[])[0] : o[k];
      if (typeof val === 'string' && /^tl-[0-9a-f-]{36}$/.test(val)) return val;
    }
  }
  for (const k of Object.keys(o)) { const r = findExternalIdentifier(o[k], depth + 1); if (r) return r; }
  return null;
}
