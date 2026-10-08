import { env } from './env.ts';

/**
 * האדפטר ל-SUMIT (sumit.co.il) — הגבייה בכרטיס. כמו ספק הוואטסאפ: ממשק
 * אחד, שני מימושים (הרצה יבשה / אמיתי), ואף אחד מהם לא נוגע במסד.
 *
 * מה אומת מול ארגון הבדיקה (docs/sumit-contract.md):
 *   · beginredirect: Customer + Items חובה; מחזירה Data.RedirectURL עם redirectid.
 *     בחזרה מתשלום מוצלח SUMIT מוסיפה ל-RedirectURL את OG-PaymentID, OG-CustomerID
 *     ו-OG-ExternalIdentifier.
 *   · payments/get לפי PaymentID (מספרי). הקבלה (documents/getdetails) נושאת את
 *     Customer.ExternalIdentifier שלנו.
 *
 * ★ פרטיות (0036): החשבון ב-SUMIT הוא החשבון העסקי של הלקוחה, עם תשלומים של לקוחות
 *   אחרים שאינם קשורים לחוג. אנחנו לא שולפים רשימות ולא פותחים תשלום או קבלה של אף
 *   אחד אחר. תשלום מזוהה רק לפי מזהה ש-SUMIT מסרה עבור הקישור שלנו (חזרה מהדף / IPN):
 *   payments/get של המזהה הזה בלבד → בדיקת הלקוחה/הסכום/התאריך מול הקישור → ורק אז
 *   הקבלה שלו, שמאשרת את ה-ExternalIdentifier שלנו. בלי מזהה — אין פנייה בכלל.
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

export type MatchMethod = 'external_identifier' | 'redirect_id' | 'payment_id' | 'heuristic';
export type PaymentStatus =
  /** pending: התשלום שלנו נמצא, הקבלה עוד לא נוצרה (שניות). rejected: המזהה אינו של הקישור — לא נבדק הלאה. */
  | { ok: true; found: false; pending?: boolean; rejected?: string; dryRun: boolean }
  | { ok: true; found: true; paid: boolean; amount: number; paymentId: string; documentId: string | null; paidAt: string | null;
      customerId: string | null; match: MatchMethod; documentUrl?: string | null; dryRun: boolean }
  | { ok: false; error: string; dryRun: boolean };

/** מה שצריך כדי לאמת את התשלום של קישור ב-SUMIT. */
export type LinkRef = {
  token?: string;
  external_identifier: string; amount: number; created_at?: string | null;
  customer_name?: string | null; redirect_id?: string | null;
  /** מזהה תשלום ש-SUMIT מסרה לקישור הזה (OG-PaymentID בחזרה מהדף, או IPN). בלי — אין פנייה. */
  payment_id?: string | null;
  /** OG-CustomerID מהחזרה, אם הגיע. */
  customer_candidate?: string | null;
  /** מזהה הלקוחה ב-SUMIT שכבר אומת עבור התלמידה (תשלום קודם / הוראת קבע). */
  known_customer_id?: string | null;
  /** מאיפה הגיע payment_id: 'ipn' (שרת SUMIT, סוד משותף) או 'redirect' (דפדפן ההורה). */
  source?: 'redirect' | 'ipn' | null;
};

export interface SumitProvider {
  createPaymentPage(input: CreatePageInput): Promise<CreatePageResult>;
  /** מקור האמת. מתאימה תשלום לקישור לפי מה שיש. */
  getPaymentStatus(link: LinkRef): Promise<PaymentStatus>;
}

/** שורת תשלום כפי ש-SUMIT מחזירה אותה ב-payments/get (אומת). */
export type SumitPayment = {
  ID: number; CustomerID: number | null; Date: string; ValidPayment: boolean; Status: string; Amount: number;
  ExternalIdentifier: string | null; DocumentID: number | null; CustomerName?: string | null;
  Customer?: { Name?: string | null; ExternalIdentifier?: string | null } | null;
};

export type SumitDocument = { Customer?: { ID?: number | null; Name?: string | null; ExternalIdentifier?: string | null } | null; DocumentDownloadURL?: string | null; DocumentNumber?: number | null };

/**
 * ★ לפני שפותחים את הקבלה: האם התשלום שחזר מ-payments/get יכול בכלל להיות של הקישור?
 * טהורה ונבדקת. מזהה שלא עובר — לא נפתחת לו קבלה, לא נשמר ממנו כלום, והמזהה נמחק מהקישור.
 *   · אותו מזהה תשלום שביקשנו.
 *   · הלקוחה ב-SUMIT: אם כבר אומתה לתלמידה — חייבת להיות היא; אם הגיע OG-CustomerID — חייב להתאים.
 *   · נוצר אחרי הקישור; תקף; בסכום של הקישור (אלא אם הלקוחה כבר מאומתת).
 */
export function ownershipBeforeReceipt(link: LinkRef, p: SumitPayment | null): { ok: true } | { ok: false; reason: string } {
  if (!p) return { ok: false, reason: 'התשלום לא נמצא ב-SUMIT' };
  if (String(p.ID) !== String(link.payment_id)) return { ok: false, reason: 'מזהה התשלום לא תואם' };
  const cid = p.CustomerID == null ? null : String(p.CustomerID);
  if (link.known_customer_id && cid !== String(link.known_customer_id)) return { ok: false, reason: 'הלקוחה ב-SUMIT אינה הלקוחה של התלמידה' };
  if (link.customer_candidate && cid !== String(link.customer_candidate)) return { ok: false, reason: 'הלקוחה ב-SUMIT אינה זו שהדף דיווח' };
  const since = link.created_at ? new Date(link.created_at).getTime() - 60_000 : 0;
  if (new Date(p.Date).getTime() < since) return { ok: false, reason: 'התשלום נעשה לפני שהקישור נוצר' };
  if (!link.known_customer_id && Math.abs(Number(p.Amount) - Number(link.amount)) >= 0.005) return { ok: false, reason: 'הסכום אינו הסכום של הקישור' };
  return { ok: true };
}

// ─────────────────────────── הרצה יבשה ───────────────────────────
// תשובות מוקלטות לפי ה-ExternalIdentifier, כדי שבדיקה תוכל לביים כל מצב:
//   *-paid      → שולם במלואו (הסכום שהתבקש)
//   *-partial   → שולם 50 פחות
//   *-unpaid    → קיים, לא שולם
//   *-sumit-down→ שגיאת ספק
//   אחרת        → לא נמצא (עדיין לא שולם / הדף לא נפתח)
export const DRY_RUN_PAGE_URL = 'https://pay.sumit.co.il/dry-run/';

/**
 * שער ההשקה: כל עוד SUMIT_CHECKOUT_ALLOW_TOKEN מוגדר, רק הקישור הזה מקבל
 * דף תשלום אמיתי. כל הורה אחרת מקבלת "ייפתח בקרוב". הסוד נמחק אחרי
 * שתשלום הבדיקה מול הארגון האמיתי עבר ← הדף נפתח לכולן.
 */
export const CHECKOUT_CLOSED_MESSAGE = 'התשלום המקוון ייפתח בקרוב. נעדכן אותך בוואטסאפ ברגע שאפשר לשלם.';
export function checkoutOpenFor(token: string, allowToken: string | null | undefined): boolean {
  const allow = (allowToken ?? '').trim();
  if (allow === '') return true;
  return token === allow;
}

class DryRunSumitProvider implements SumitProvider {
  /** סכומים שנוצרו בדף — כדי ש"שולם" יחזיר את הסכום הנכון. */
  static amounts = new Map<string, number>();
  async createPaymentPage(input: CreatePageInput): Promise<CreatePageResult> {
    DryRunSumitProvider.amounts.set(input.externalIdentifier, input.amount);
    console.log(`[SUMIT_DRY_RUN] דף תשלום: ${input.externalIdentifier} · ${input.amount} ₪ · ${input.customerName}`);
    return await Promise.resolve({ ok: true, url: `${DRY_RUN_PAGE_URL}${encodeURIComponent(input.externalIdentifier)}`, dryRun: true });
  }
  async getPaymentStatus(link: LinkRef): Promise<PaymentStatus> {
    const externalIdentifier = link.external_identifier;
    const amount = DryRunSumitProvider.amounts.get(externalIdentifier) ?? Number(externalIdentifier.match(/amount=(\d+(?:\.\d+)?)/)?.[1] ?? 0);
    const id = `dry-${externalIdentifier}`;
    if (externalIdentifier.endsWith('-sumit-down')) return await Promise.resolve({ ok: false, error: 'SUMIT לא זמינה (מוקלט)', dryRun: true });
    if (externalIdentifier.endsWith('-paid')) return await Promise.resolve({ ok: true, found: true, paid: true, amount, paymentId: id, documentId: `doc-${id}`, paidAt: new Date().toISOString(), customerId: null, match: 'external_identifier', dryRun: true });
    if (externalIdentifier.endsWith('-partial')) return await Promise.resolve({ ok: true, found: true, paid: true, amount: Math.max(0, amount - 50), paymentId: id, documentId: `doc-${id}`, paidAt: new Date().toISOString(), customerId: null, match: 'external_identifier', dryRun: true });
    if (externalIdentifier.endsWith('-unpaid')) return await Promise.resolve({ ok: true, found: true, paid: false, amount, paymentId: id, documentId: null, paidAt: null, customerId: null, match: 'external_identifier', dryRun: true });
    return await Promise.resolve({ ok: true, found: false, dryRun: true });
  }
}

// ─────────────────────────── SUMIT אמיתי (אומת מול ארגון הבדיקה) ───────────────────────────
type Envelope = { Data: unknown; Status: number; UserErrorMessage: string | null; TechnicalErrorDetails: string | null };

class RealSumitProvider implements SumitProvider {
  private credentials() {
    const companyId = env('SUMIT_COMPANY_ID'), apiKey = env('SUMIT_API_KEY');
    if (!companyId || !apiKey) throw new Error('חסרים SUMIT_COMPANY_ID / SUMIT_API_KEY');
    return { CompanyID: Number(companyId), APIKey: apiKey };
  }
  /** המעטפה (אומת): HTTP 200 תמיד; Status 0 = הצלחה, 1 = שגיאה עסקית, 2 = גוף לא תואם. */
  private async post(path: string, body: Record<string, unknown>): Promise<Envelope> {
    const res = await fetch(`${SUMIT_API_BASE}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ Credentials: this.credentials(), ...body }), redirect: 'manual',
    });
    if (res.status >= 300 && res.status < 400) throw new Error(`SUMIT: הנתיב ${path} אינו קיים (הפניה)`);
    const text = await res.text();
    let json: Envelope;
    try { json = JSON.parse(text); } catch { throw new Error(`SUMIT החזירה תשובה שאינה JSON (HTTP ${res.status})`); }
    if (json.Status !== 0) throw new Error(`SUMIT: ${json.UserErrorMessage ?? json.TechnicalErrorDetails ?? `Status ${json.Status}`}`);
    return json;
  }
  async createPaymentPage(input: CreatePageInput): Promise<CreatePageResult> {
    try {
      const json = await this.post('/billing/payments/beginredirect/', {
        Customer: { Name: input.customerName, Phone: input.customerPhone ?? undefined, ExternalIdentifier: input.externalIdentifier, SearchMode: 0 },
        Items: [{ Item: { Name: input.description }, Quantity: 1, UnitPrice: input.amount, TotalPrice: input.amount, Currency: 'ILS' }],
        ExternalIdentifier: input.externalIdentifier,
        RedirectURL: input.redirectUrl,
        IPNURL: env('SUMIT_IPN_URL') ?? undefined,
        Language: 0, VATIncluded: true, MaximumPayments: 1,
      });
      const url = String((json.Data as { RedirectURL?: string })?.RedirectURL ?? '');
      if (!url) return { ok: false, error: 'SUMIT לא החזירה כתובת דף תשלום', dryRun: false };
      return { ok: true, url, dryRun: false };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'שגיאה לא ידועה', dryRun: false };
    }
  }
  async getPaymentStatus(link: LinkRef): Promise<PaymentStatus> {
    // ★ בלי מזהה ש-SUMIT מסרה לקישור הזה — אין פנייה. אין list, אין סריקה.
    if (!link.payment_id || !/^\d{1,18}$/.test(String(link.payment_id))) return { ok: true, found: false, dryRun: false };
    // ★ מזהה מהדפדפן שסותר את הלקוחה שכבר אומתה לתלמידה — נדחה בלי שום פנייה ל-SUMIT.
    if (link.known_customer_id && link.customer_candidate && String(link.known_customer_id) !== String(link.customer_candidate)) {
      return { ok: true, found: false, rejected: 'הלקוחה שדווחה אינה הלקוחה של התלמידה', dryRun: false };
    }
    // ★ מהדפדפן בלי מספר לקוחה (OG-CustomerID) ובלי לקוחה מאומתת — אין במה לאמת לפני הקבלה. לא פונים.
    if (link.source !== 'ipn' && !link.customer_candidate && !link.known_customer_id) {
      return { ok: true, found: false, rejected: 'חסר מספר הלקוחה מ-SUMIT', dryRun: false };
    }
    try {
      const p = (((await this.post('/billing/payments/get/', { PaymentID: Number(link.payment_id) })).Data) as { Payment?: SumitPayment })?.Payment ?? null;
      const own = ownershipBeforeReceipt(link, p);
      if (!own.ok) return { ok: true, found: false, rejected: own.reason, dryRun: false };
      const pay = p as SumitPayment;
      if (!pay.ValidPayment) {
        return { ok: true, found: true, paid: false, amount: Number(pay.Amount), paymentId: String(pay.ID), documentId: null, paidAt: null,
                 customerId: pay.CustomerID != null ? String(pay.CustomerID) : null, match: 'payment_id', dryRun: false };
      }
      // הקבלה נוצרת כמה שניות אחרי התשלום. בלי קבלה עוד אין אישור שזה שלנו — מחכים.
      if (!pay.DocumentID) return { ok: true, found: false, pending: true, dryRun: false };
      const data = (await this.post('/accounting/documents/getdetails/', { DocumentID: pay.DocumentID })).Data as
        { Document?: SumitDocument; DocumentDownloadURL?: string | null } | undefined;
      // ★ הקבלה של התשלום הזה חייבת לשאת את המזהה שלנו. אחרת — לא שלנו, לא נרשם כלום.
      if (data?.Document?.Customer?.ExternalIdentifier !== link.external_identifier) {
        return { ok: true, found: false, rejected: 'הקבלה אינה נושאת את המזהה של הקישור', dryRun: false };
      }
      return { ok: true, found: true, paid: true, amount: Number(pay.Amount), paymentId: String(pay.ID), documentId: String(pay.DocumentID),
               paidAt: pay.Date ?? null, customerId: pay.CustomerID != null ? String(pay.CustomerID) : null, match: 'payment_id',
               // אומת: קישור ההורדה ברמת Data, לא בתוך Document.
               documentUrl: data?.DocumentDownloadURL ?? null, dryRun: false };
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
export type IpnCandidates = { external_identifier: string | null; redirect_id: string | null; token: string | null; payment_id: string | null };

/** מהגוף של ה-IPN — כל מה שיכול להצביע על קישור שלנו, או על תשלום ב-SUMIT. */
export function extractIpnCandidates(contentType: string, rawBody: string): IpnCandidates {
  const out: IpnCandidates = { external_identifier: extractExternalIdentifier(contentType, rawBody), redirect_id: null, token: null, payment_id: null };
  // גוף טופס מקודד (%2F): מפענחים לפני החיפוש. פענוח שנכשל — הגוף כמו שהוא.
  let text = rawBody; try { text = decodeURIComponent(rawBody); } catch { /* raw */ }
  rawBody = text;
  const rid = rawBody.match(/redirectid[=%:"\s]*([0-9a-fA-F]{8}-[0-9a-fA-F-]{27,})/i) ?? rawBody.match(/"RedirectID"\s*:\s*"([0-9a-fA-F-]{36})"/i);
  if (rid) out.redirect_id = rid[1];
  const tok = rawBody.match(/\/pay\/([0-9a-f]{64})/);
  if (tok) out.token = tok[1];
  const pid = rawBody.match(/"(?:PaymentID|ID)"\s*:\s*"?(\d{6,})"?/) ?? rawBody.match(/(?:^|&)(?:PaymentID|paymentid)=(\d{6,})/i);
  if (pid) out.payment_id = pid[1];
  return out;
}

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
