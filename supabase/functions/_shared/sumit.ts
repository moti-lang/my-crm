import { env } from './env.ts';

/**
 * האדפטר ל-SUMIT (sumit.co.il) — הגבייה בכרטיס. כמו ספק הוואטסאפ: ממשק
 * אחד, שני מימושים (הרצה יבשה / אמיתי), ואף אחד מהם לא נוגע במסד.
 *
 * מה אומת מול ארגון הבדיקה (docs/sumit-contract.md):
 *   · beginredirect: Customer + Items חובה; מחזירה Data.RedirectURL עם redirectid.
 *   · אין שליפה לפי ExternalIdentifier, והוא לא בהכרח נשמר על התשלום. השליפה
 *     היא payments/list לפי טווח תאריכים, וההתאמה: ExternalIdentifier כשיש,
 *     אחרת שם הלקוחה + סכום + אחרי יצירת הקישור — רק כשיש מועמד יחיד.
 *   · payments/get לפי PaymentID (מספרי). שורת תשלום לא נושאת שם לקוחה.
 *   · ★ הקבלה (accounting/documents/getdetails לפי DocumentID של התשלום) נושאת
 *     את Customer.ExternalIdentifier שלנו, Customer.ID וקישור הורדה. זה המפתח:
 *     תשלום תקף → קבלה → המזהה שלנו → הקישור. ההיוריסטיקה היא גיבוי בלבד.
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
  | { ok: true; found: false; dryRun: boolean }
  | { ok: true; found: true; paid: boolean; amount: number; paymentId: string; documentId: string | null; paidAt: string | null;
      customerId: string | null; match: MatchMethod; documentUrl?: string | null; dryRun: boolean }
  | { ok: false; error: string; dryRun: boolean };

/** מה שצריך כדי למצוא את התשלום של קישור ב-SUMIT. */
export type LinkRef = {
  external_identifier: string; amount: number; created_at?: string | null;
  customer_name?: string | null; redirect_id?: string | null;
  /** מזהה תשלום שה-IPN הביא, אם הביא. */
  payment_id?: string | null;
};

export interface SumitProvider {
  createPaymentPage(input: CreatePageInput): Promise<CreatePageResult>;
  /** מקור האמת. מתאימה תשלום לקישור לפי מה שיש. */
  getPaymentStatus(link: LinkRef): Promise<PaymentStatus>;
}

/** שורת תשלום כפי ש-SUMIT מחזירה אותה ב-payments/list וב-payments/get (אומת). */
export type SumitPayment = {
  ID: number; CustomerID: number | null; Date: string; ValidPayment: boolean; Status: string; Amount: number;
  ExternalIdentifier: string | null; DocumentID: number | null; CustomerName?: string | null;
  Customer?: { Name?: string | null; ExternalIdentifier?: string | null } | null;
};

const norm = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ');

export type SumitDocument = { Customer?: { ID?: number | null; Name?: string | null; ExternalIdentifier?: string | null } | null; DocumentDownloadURL?: string | null; DocumentNumber?: number | null };

/**
 * מעשיר תשלומים תקפים בפרטי הלקוחה מהקבלה שלהם (אומת: רק שם יש את המזהה שלנו).
 * הקבלה נוצרת כמה שניות אחרי התשלום: list מראה DocumentID=0, get כבר מראה אותו.
 * fetchers מוזרקים — נבדק בלי רשת. תקרה למספר קריאות, כדי שלולאת cron לא תתפוצץ.
 */
export async function enrichWithDocuments(
  payments: SumitPayment[], link: LinkRef,
  fetchers: { getPayment: (id: number) => Promise<SumitPayment | null>; getDocument: (id: number) => Promise<SumitDocument | null> },
  cap = 25,
): Promise<(SumitPayment & { DocumentURL?: string | null })[]> {
  const since = link.created_at ? new Date(link.created_at).getTime() - 60_000 : 0;
  const amount = Number(link.amount);
  const candidates = payments
    .filter((p) => p.ValidPayment && new Date(p.Date).getTime() >= since)
    .sort((a, b) => Number(Number(b.Amount) === amount) - Number(Number(a.Amount) === amount))
    .slice(0, cap);
  const out: (SumitPayment & { DocumentURL?: string | null })[] = [];
  for (const p of candidates) {
    let docId = p.DocumentID ?? 0;
    if (!docId) { const fresh = await fetchers.getPayment(p.ID); docId = fresh?.DocumentID ?? 0; }
    if (!docId) { out.push(p); continue; }
    const doc = await fetchers.getDocument(docId);
    out.push({ ...p, DocumentID: docId,
      Customer: doc?.Customer ? { Name: doc.Customer.Name ?? null, ExternalIdentifier: doc.Customer.ExternalIdentifier ?? null } : p.Customer ?? null,
      CustomerName: p.CustomerName ?? doc?.Customer?.Name ?? null,
      DocumentURL: doc?.DocumentDownloadURL ?? null });
    // המזהה שלנו נמצא — אין טעם להמשיך לשלוף קבלות של אחרות.
    if (doc?.Customer?.ExternalIdentifier === link.external_identifier) break;
  }
  return out;
}

/**
 * ההתאמה, טהורה ונבדקת: המועמדים הם תשלומים תקפים (ValidPayment) שנוצרו
 * אחרי הקישור. מזהה מפורש מנצח; אחרת שם+סכום, ורק אם המועמד יחיד.
 */
export function matchPayment(link: LinkRef, payments: SumitPayment[]): { payment: SumitPayment; match: MatchMethod } | null {
  const since = link.created_at ? new Date(link.created_at).getTime() - 60_000 : 0;
  const valid = payments.filter((p) => p.ValidPayment && new Date(p.Date).getTime() >= since);
  if (link.payment_id) {
    const byId = valid.find((p) => String(p.ID) === String(link.payment_id));
    if (byId) return { payment: byId, match: 'payment_id' };
  }
  const byExt = valid.find((p) => p.ExternalIdentifier === link.external_identifier || p.Customer?.ExternalIdentifier === link.external_identifier);
  if (byExt) return { payment: byExt, match: 'external_identifier' };
  if (!link.customer_name) return null;
  const amount = Number(link.amount);
  const heur = valid.filter((p) => Number(p.Amount) === amount && norm(p.CustomerName ?? p.Customer?.Name) === norm(link.customer_name)
    && !p.ExternalIdentifier);
  return heur.length === 1 ? { payment: heur[0], match: 'heuristic' } : null;
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
    try {
      let payments: SumitPayment[] = [];
      if (link.payment_id) {
        const one = await this.post('/billing/payments/get/', { PaymentID: Number(link.payment_id) }).catch(() => null);
        const p = (one?.Data as { Payment?: SumitPayment })?.Payment;
        if (p) payments = [p];
      }
      if (!payments.length) {
        // חלון: מיצירת הקישור (פחות יום, לשעון) ועד מחר.
        const from = new Date(link.created_at ? new Date(link.created_at).getTime() - 86400_000 : Date.now() - 9 * 86400_000);
        const to = new Date(Date.now() + 86400_000);
        const d = (x: Date) => x.toISOString().slice(0, 10);
        const list = await this.post('/billing/payments/list/', { Date_From: d(from), Date_To: d(to) });
        payments = ((list.Data as { Payments?: SumitPayment[] })?.Payments ?? []);
      }
      const enriched = await enrichWithDocuments(payments, link, {
        getPayment: async (id) => ((await this.post('/billing/payments/get/', { PaymentID: id }).catch(() => null))?.Data as { Payment?: SumitPayment })?.Payment ?? null,
        // אומת: ב-getdetails הלקוחה בתוך Data.Document, אבל קישור ההורדה ב-Data עצמו.
        getDocument: async (id) => {
          const data = (await this.post('/accounting/documents/getdetails/', { DocumentID: id }).catch(() => null))?.Data as
            { Document?: SumitDocument; DocumentDownloadURL?: string | null; DocumentNumber?: number | null } | undefined;
          return data?.Document ? { ...data.Document, DocumentDownloadURL: data.DocumentDownloadURL ?? null, DocumentNumber: data.DocumentNumber ?? null } : null;
        },
      });
      const m = matchPayment(link, enriched);
      if (!m) return { ok: true, found: false, dryRun: false };
      const p = m.payment as SumitPayment & { DocumentURL?: string | null };
      return { ok: true, found: true, paid: p.ValidPayment === true, amount: Number(p.Amount), paymentId: String(p.ID),
               documentId: p.DocumentID ? String(p.DocumentID) : null, paidAt: p.Date ?? null,
               customerId: p.CustomerID != null ? String(p.CustomerID) : null, match: m.match, documentUrl: p.DocumentURL ?? null, dryRun: false };
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
