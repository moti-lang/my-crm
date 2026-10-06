import { env, WA_DRY_RUN } from './env.ts';

// ─────────── הגדרות השרת: env, ואם אין — wa_config (ממולא ע"י wa-provision) ───────────
export type WaConfig = { url: string; apiKey: string; webhookSecret: string };
let cached: { at: number; cfg: WaConfig | null } | null = null;

/** כתובת, מפתח וסוד של שרת הוואטסאפ. משתני סביבה גוברים; אחרת הטבלה (מטמון 60 שניות). */
export async function waConfig(): Promise<WaConfig | null> {
  const url = env('WA_SERVER_URL'), apiKey = env('WA_API_KEY'), webhookSecret = env('WA_WEBHOOK_SECRET');
  if (url && apiKey && webhookSecret) return { url: url.replace(/\/+$/, ''), apiKey, webhookSecret };
  if (cached && Date.now() - cached.at < 60_000) return cached.cfg;
  // REST ישיר עם service_role (בלי supabase-js — הקובץ נטען גם בבדיקות Node).
  const base = env('SUPABASE_URL'), key = env('SUPABASE_SERVICE_ROLE_KEY');
  let data: { server_url?: string; api_key?: string; webhook_secret?: string } | undefined;
  if (base && key) {
    const res = await fetch(`${base}/rest/v1/wa_config?id=eq.1&select=server_url,api_key,webhook_secret`,
      { headers: { apikey: key, authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
    data = res?.ok ? ((await res.json()) as typeof data[])?.[0] : undefined;
  }
  const cfg = data?.server_url && data.api_key && data.webhook_secret
    ? { url: String(data.server_url).replace(/\/+$/, ''), apiKey: String(data.api_key), webhookSecret: String(data.webhook_secret) }
    : null;
  cached = { at: Date.now(), cfg };
  return cfg;
}

async function requireWaConfig(): Promise<WaConfig> {
  const c = await waConfig();
  if (!c) throw new Error('שרת הוואטסאפ עוד לא חובר (אין WA_SERVER_URL ואין wa_config)');
  return c;
}

/**
 * מדבר מול whatsapp-hub — השרת העצמאי (moti-lang/whatsapp-hub).
 * החוזה נלקח מהקוד שלו, לא מהנחות:
 *   POST {WA_SERVER_URL}/api/send    {phone, text, source?}   + x-api-key + Idempotency-Key
 *   GET  {WA_SERVER_URL}/api/health                            + x-api-key   (503 כשמנותק)
 *   webhook נכנס: כותרות x-hub-event / x-hub-delivery / x-hub-signature (HMAC-SHA256)
 */

export type SendResult =
  | { ok: true; providerMsgId: string | null; dryRun: boolean }
  | { ok: false; error: string; retryable: boolean };

export type HealthResult =
  | { ok: true; dryRun: boolean; state: string }
  | { ok: false; error: string; state: string };

/** הודעה נכנסת אחרי נרמול. providerMsgId חובה — בלעדיו אין מניעת כפילויות. */
export type IncomingMessage = {
  providerMsgId: string;
  from: string;
  body: string;
  contactName: string | null;
  receivedAt: string;
  raw: unknown;
};

export interface WhatsAppProvider {
  sendText(to: string, body: string, idempotencyKey: string): Promise<SendResult>;
  checkHealth(): Promise<HealthResult>;
  parseIncoming(payload: unknown): IncomingMessage | null;
}

// ───────────────────────────── הרצה יבשה ─────────────────────────────

class DryRunProvider implements WhatsAppProvider {
  async sendText(to: string, body: string): Promise<SendResult> {
    console.log(`[WA_DRY_RUN] היעד ${to} · ${body.length} תווים · לא נשלח`);
    return await Promise.resolve({ ok: true, providerMsgId: null, dryRun: true });
  }

  async checkHealth(): Promise<HealthResult> {
    return await Promise.resolve({ ok: true, dryRun: true, state: 'dry-run' });
  }

  parseIncoming(payload: unknown): IncomingMessage | null {
    return parseHubEvent(payload);
  }
}

// ─────────────────────────── whatsapp-hub ───────────────────────────

class SelfHostedProvider implements WhatsAppProvider {
  private async base(): Promise<string> {
    return (await requireWaConfig()).url;
  }

  private async headers(extra: Record<string, string> = {}): Promise<HeadersInit> {
    return {
      'content-type': 'application/json',
      'x-api-key': (await requireWaConfig()).apiKey,
      ...extra,
    };
  }

  async sendText(to: string, body: string, idempotencyKey: string): Promise<SendResult> {
    try {
      const res = await fetch(`${await this.base()}/api/send`, {
        method: 'POST',
        headers: await this.headers({ 'Idempotency-Key': idempotencyKey }),
        // השרת מצפה ל-phone/text, לא to/body.
        body: JSON.stringify({ phone: to, text: body, source: 'teichtal-crm' }),
        signal: AbortSignal.timeout(20_000),
      });

      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

      // 409 = אותו Idempotency-Key כבר בביצוע. זו לא שגיאה אמיתית ואסור
      // לנסות שוב עם אותו מפתח — ההודעה כבר בדרך.
      if (res.status === 409) {
        return { ok: false, error: 'בקשה זהה כבר בביצוע בשרת', retryable: false };
      }
      if (!res.ok || json.ok === false) {
        const error = typeof json.error === 'string' ? json.error : `שרת הוואטסאפ החזיר ${res.status}`;
        // 4xx = הבקשה שלנו פגומה. 5xx / 429 = שווה ניסיון נוסף.
        return { ok: false, error, retryable: res.status >= 500 || res.status === 429 };
      }

      // waId הוא מזהה ההודעה של וואטסאפ. יכול לחזור null אם השליחה
      // הצליחה אבל לא הוחזר מזהה — עדיין הצלחה.
      const waId = typeof json.waId === 'string' ? json.waId : null;
      return { ok: true, providerMsgId: waId, dryRun: false };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : 'שגיאת רשת',
        retryable: true,
      };
    }
  }

  async checkHealth(): Promise<HealthResult> {
    try {
      const res = await fetch(`${await this.base()}/api/health`, {
        method: 'GET',
        headers: await this.headers(),
        signal: AbortSignal.timeout(10_000),
      });
      const json = (await res.json().catch(() => ({}))) as {
        healthy?: boolean;
        whatsapp?: { state?: string; lastError?: string | null };
      };
      const state = json.whatsapp?.state ?? (res.ok ? 'unknown' : `http_${res.status}`);

      // השרת מחזיר 503 כשוואטסאפ אינו מחובר — התהליך חי אבל החיבור נפל.
      if (res.status === 503 || json.healthy === false) {
        return { ok: false, error: json.whatsapp?.lastError ?? `החיבור לוואטסאפ במצב "${state}"`, state };
      }
      if (!res.ok) return { ok: false, error: `/api/health החזיר ${res.status}`, state };
      return { ok: true, dryRun: false, state };
    } catch (e) {
      // כאן השרת עצמו לא עונה — נפילה מלאה, לא רק ניתוק וואטסאפ.
      return { ok: false, error: e instanceof Error ? e.message : 'השרת אינו עונה', state: 'unreachable' };
    }
  }

  parseIncoming(payload: unknown): IncomingMessage | null {
    return parseHubEvent(payload);
  }
}

// ───────────────────── פרסור אירוע נכנס מה-Hub ─────────────────────

/**
 * מבנה המעטפת של ה-Hub: { event, timestamp, data }.
 * ל-message.received: data = { id, phone, display, name, type, text, waId, receivedAt, ... }
 *
 * הכלל שאין ממנו חריגה: בלי מזהה — מחזירים null ולא מעבדים.
 * עיבוד הודעה בלי מזהה שובר את מניעת הכפילויות, וכפילות בפקודה כספית
 * היא הוצאה שנרשמת פעמיים.
 */
export function parseHubEvent(payload: unknown): IncomingMessage | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  const data = (root.data ?? root) as Record<string, unknown>;

  // id הוא מזהה השורה ב-Hub; waId הוא של וואטסאפ. שניהם יציבים, id תמיד קיים.
  const rawId = data.id ?? data.waId;
  const providerMsgId = rawId === null || rawId === undefined ? null : String(rawId).trim() || null;
  if (!providerMsgId) return null;

  const from = typeof data.phone === 'string' ? data.phone.trim() : null;
  if (!from) return null;

  return {
    providerMsgId,
    from,
    body: typeof data.text === 'string' ? data.text : '',
    contactName: typeof data.name === 'string' ? data.name : null,
    receivedAt: typeof data.receivedAt === 'string' ? data.receivedAt : new Date().toISOString(),
    raw: payload,
  };
}

// ───────────────────── אימות חתימת ה-webhook ─────────────────────

/**
 * ה-Hub חותם HMAC-SHA256 על גוף הבקשה הגולמי ושולח 'sha256=<hex>'
 * בכותרת x-hub-signature. חייבים לאמת מול הגוף הגולמי — לא מול
 * JSON שעבר פרסור וסריאליזציה מחדש, כי אלה בתים אחרים.
 */
export async function verifyHubSignature(rawBody: string, header: string | null): Promise<boolean> {
  // סוד מ-env גובר (גם כשהכתובת והמפתח בטבלה); אחרת מהטבלה.
  const secret = env('WA_WEBHOOK_SECRET') ?? (await waConfig().catch(() => null))?.webhookSecret;
  if (!secret || !header) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = 'sha256=' + Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  if (expected.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}

export function whatsappProvider(): WhatsAppProvider {
  return WA_DRY_RUN ? new DryRunProvider() : new SelfHostedProvider();
}
