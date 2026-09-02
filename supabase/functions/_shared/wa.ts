import { env, requireEnv, WA_DRY_RUN } from './env.ts';

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
  private base(): string {
    return requireEnv('WA_SERVER_URL').replace(/\/+$/, '');
  }

  private headers(extra: Record<string, string> = {}): HeadersInit {
    return {
      'content-type': 'application/json',
      'x-api-key': requireEnv('WA_API_KEY'),
      ...extra,
    };
  }

  async sendText(to: string, body: string, idempotencyKey: string): Promise<SendResult> {
    try {
      const res = await fetch(`${this.base()}/api/send`, {
        method: 'POST',
        headers: this.headers({ 'Idempotency-Key': idempotencyKey }),
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
      const res = await fetch(`${this.base()}/api/health`, {
        method: 'GET',
        headers: this.headers(),
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
  const secret = env('WA_WEBHOOK_SECRET');
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
