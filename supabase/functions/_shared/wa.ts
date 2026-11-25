/**
 * ★ שכבת הוואטסאפ — הקובץ היחיד במערכת שמדבר עם הספק.
 *
 * הספק: GOWA (go-whatsapp-web-multidevice) v9, REST. החוזה נלקח מהתיעוד והקוד של הגרסה
 * v9.10.0 (docs/openapi.yaml, docs/webhook-payload.md) — ראו docs/whatsapp-contract.md.
 *
 *   POST /send/message   {phone, message}                       → results.message_id
 *   POST /send/image     multipart: phone, caption, image | image_url
 *   POST /send/file      multipart: phone, caption, file  | file_url
 *   GET  /app/status     → results.is_connected, is_logged_in, jid
 *   GET  /app/login      → results.qr_link (תמונת PNG), qr_duration
 *   GET  /app/logout
 *   אימות: Basic Auth (WA_USER / WA_PASS) + כותרת X-Device-Id (WA_DEVICE_ID) בכל קריאה.
 *   webhook נכנס: X-Hub-Signature-256: sha256=<hex HMAC-SHA256 של הגוף הגולמי> (WA_WEBHOOK_SECRET).
 *
 * ★ הסודות רק במשתני הסביבה של ה-Edge Functions — לא בקוד, לא בגיט ולא בדפדפן. כשהם חסרים
 *   הכל ממשיך לעבוד: המצב "לא מוגדר", שום דבר לא קורס ושום דבר לא נשלח.
 *
 * ★ מתי הודעה יוצאת באמת (realSendAllowed):
 *   · WA_TEST_PHONE מוגדר — רק למספר הזה; כל השאר בהרצה יבשה (גם אם WA_DRY_RUN=false).
 *   · אחרת — רק כש-WA_DRY_RUN=false במפורש. ברירת המחדל: הרצה יבשה.
 *   מצב, QR וניתוק פונים ל-GOWA גם בהרצה יבשה — אחרת אי אפשר לחבר את המספר.
 *
 * ★ הטלפון: נרמול אחד (phone.ts). הסיומת @s.whatsapp.net מתווספת רק כאן (toJid).
 */
import { env } from './env.ts';
import { normalizePhone } from './phone.ts';

// ─────────────────────────── הגדרות ───────────────────────────

export type WaConfig = { baseUrl: string; deviceId: string; user: string; pass: string };

/** חמשת המשתנים — או null כשחסר אחד מהם ("לא מוגדר"). WA_WEBHOOK_SECRET נבדק בנפרד, רק ב-webhook. */
export function waConfig(): WaConfig | null {
  const baseUrl = env('WA_BASE_URL'), deviceId = env('WA_DEVICE_ID'), user = env('WA_USER'), pass = env('WA_PASS');
  if (!baseUrl || !deviceId || !user || !pass) return null;
  // רק https, ורק כתובת בסיס (בלי נתיב / פרטי משתמש בכתובת) — שלא תצא סיסמה לכתובת אחרת.
  let u: URL;
  try { u = new URL(baseUrl); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  return { baseUrl: `${u.origin}${u.pathname.replace(/\/+$/, '')}`, deviceId, user, pass };
}

/** WA_TEST_PHONE מנורמל, או null. */
export function waTestPhone(): string | null {
  const t = env('WA_TEST_PHONE');
  return t ? normalizePhone(t) : null;
}

/** הרצה יבשה אלא אם WA_DRY_RUN=false במפורש. נקרא בכל פעם (לא נקבע בטעינה). */
export function waDryRun(): boolean {
  return (env('WA_DRY_RUN') ?? 'true') !== 'false';
}

/** ★ האם הודעה למספר הזה יוצאת באמת. בלי הגדרות — אף פעם. */
export function realSendAllowed(to: string): boolean {
  if (!waConfig()) return false;
  const test = waTestPhone();
  if (test) return normalizePhone(to) === test;
  return !waDryRun();
}

/** המזהה של וואטסאפ — רק כאן. */
export function toJid(phone: string): string {
  return `${normalizePhone(phone)}@s.whatsapp.net`;
}

// ─────────────────────────── טיפוסים ───────────────────────────

export type SendResult =
  | { ok: true; providerMsgId: string | null; dryRun: boolean }
  /**
   * retryable — GOWA לא קיבלה את הבקשה (שער / עומס): אפשר לנסות שוב.
   * uncertain — הבקשה יצאה ולא חזרה תשובה (פג זמן / ניתוק): ייתכן שנשלחה. ★ ל-GOWA אין מפתח
   *   ייחודיות — ניסיון חוזר עלול לשלוח פעמיים, ולכן לא חוזרים על כזו אוטומטית.
   * notConfigured — אין הגדרות: לא נשלח, ולא נכשל (מחכים בתור).
   */
  | { ok: false; error: string; retryable: boolean; uncertain?: boolean; notConfigured?: boolean };

export type HealthResult =
  | { ok: true; dryRun: boolean; state: string }
  | { ok: false; error: string; state: string };

export type WaStatus =
  | { configured: false }
  | { configured: true; ok: true; connected: boolean; loggedIn: boolean; phone: string | null }
  | { configured: true; ok: false; error: string };

export type QrResult =
  | { ok: true; qrDataUrl: string; durationSec: number | null }
  | { ok: false; error: string; alreadyLoggedIn?: boolean; notConfigured?: boolean };

export type Media = {
  kind: 'image' | 'file';
  /** אחד מהשניים: קובץ (תוכן), או כתובת ש-GOWA תוריד בעצמה. */
  data?: Blob;
  filename?: string;
  url?: string;
  caption?: string;
};

/** הודעה נכנסת אחרי נרמול. providerMsgId חובה — בלעדיו אין מניעת כפילויות. */
export type IncomingMessage = {
  providerMsgId: string;
  from: string;
  body: string;
  contactName: string | null;
  receivedAt: string;
  raw: unknown;
};

/** אירוע webhook אחרי פרסור: הודעה, שינוי במכשיר, אירוע שמתעלמים ממנו, או משהו שלא מזוהה. */
export type WebhookEvent =
  | { kind: 'message'; message: IncomingMessage }
  | { kind: 'device'; state: 'logged_out' | 'banned' | 'timelock'; event: string }
  | { kind: 'ignore'; reason: string }
  | { kind: 'unparsable'; reason: string };

export interface WhatsAppProvider {
  sendText(to: string, body: string, idempotencyKey: string): Promise<SendResult>;
  sendMedia(to: string, media: Media, idempotencyKey: string): Promise<SendResult>;
  checkHealth(): Promise<HealthResult>;
  status(): Promise<WaStatus>;
  loginQr(): Promise<QrResult>;
  logout(): Promise<{ ok: true } | { ok: false; error: string; notConfigured?: boolean }>;
  parseIncoming(payload: unknown): IncomingMessage | null;
}

// ─────────────────────────── GOWA ───────────────────────────

const TIMEOUT_SEND_MS = 20_000, TIMEOUT_READ_MS = 10_000;
const NOT_CONFIGURED = 'וואטסאפ לא מוגדר (חסרים WA_BASE_URL / WA_DEVICE_ID / WA_USER / WA_PASS)';

type GowaBody = { code?: string; message?: string; results?: Record<string, unknown> };

function authHeaders(cfg: WaConfig): Record<string, string> {
  return { authorization: `Basic ${btoa(`${cfg.user}:${cfg.pass}`)}`, 'x-device-id': cfg.deviceId };
}

/** הודעת שגיאה מ-GOWA — בלי לחשוף כותרות / סיסמה. */
function gowaError(status: number, body: GowaBody): string {
  if (status === 401) return 'GOWA דחתה את הסיסמה (401) — לבדוק את WA_USER / WA_PASS';
  const m = typeof body.message === 'string' && body.message ? body.message : `HTTP ${status}`;
  return `GOWA: ${m}`.slice(0, 300);
}

/** 429 ושגיאות שער (502/503/504): GOWA לא קיבלה את הבקשה — מותר לנסות שוב. */
const gatewayRetryable = (status: number) => status === 429 || status === 502 || status === 503 || status === 504;

class GowaProvider implements WhatsAppProvider {
  private async send(path: string, to: string, body: BodyInit, json: boolean): Promise<SendResult> {
    const cfg = waConfig();
    if (!cfg) return { ok: false, error: NOT_CONFIGURED, retryable: false, notConfigured: true };
    // ★ השער: בלי אישור לשליחה אמיתית — הרצה יבשה (למספר הבדיקה בלבד, או כלום).
    if (!realSendAllowed(to)) {
      console.log(`[wa dry-run] ${path} · ${normalizePhone(to).slice(0, 5)}… · לא נשלח`);
      return { ok: true, providerMsgId: null, dryRun: true };
    }
    let res: Response;
    try {
      res = await fetch(`${cfg.baseUrl}${path}`, {
        method: 'POST',
        headers: { ...authHeaders(cfg), ...(json ? { 'content-type': 'application/json' } : {}) },
        body,
        signal: AbortSignal.timeout(TIMEOUT_SEND_MS),
      });
    } catch (e) {
      // ★ הבקשה יצאה ולא חזרה תשובה — אולי נשלחה. לא חוזרים על זה (אין מפתח ייחודיות ב-GOWA).
      return { ok: false, error: `לא ברור אם נשלחה (${e instanceof Error ? e.message : 'אין תשובה'})`, retryable: false, uncertain: true };
    }
    const b = (await res.json().catch(() => ({}))) as GowaBody;
    if (!res.ok) return { ok: false, error: gowaError(res.status, b), retryable: gatewayRetryable(res.status) };
    const id = b.results?.message_id;
    return { ok: true, providerMsgId: typeof id === 'string' && id ? id : null, dryRun: false };
  }

  sendText(to: string, body: string, _idempotencyKey: string): Promise<SendResult> {
    return this.send('/send/message', to, JSON.stringify({ phone: toJid(to), message: body }), true);
  }

  sendMedia(to: string, media: Media, _idempotencyKey: string): Promise<SendResult> {
    if (!media.data === !media.url) {
      return Promise.resolve({ ok: false, error: 'קובץ לשליחה: תוכן או כתובת — אחד מהשניים', retryable: false });
    }
    if (media.url && !/^https:\/\//.test(media.url)) {
      return Promise.resolve({ ok: false, error: 'כתובת הקובץ חייבת להיות https', retryable: false });
    }
    const field = media.kind === 'image' ? 'image' : 'file';
    const form = new FormData();
    form.append('phone', toJid(to));
    if (media.caption) form.append('caption', media.caption);
    if (media.url) form.append(`${field}_url`, media.url);
    else form.append(field, media.data as Blob, media.filename ?? (media.kind === 'image' ? 'image.png' : 'file'));
    return this.send(`/send/${field}`, to, form, false);
  }

  private async get(path: string): Promise<{ status: number; body: GowaBody } | { error: string }> {
    const cfg = waConfig();
    if (!cfg) return { error: NOT_CONFIGURED };
    try {
      const res = await fetch(`${cfg.baseUrl}${path}`, { headers: authHeaders(cfg), signal: AbortSignal.timeout(TIMEOUT_READ_MS) });
      return { status: res.status, body: (await res.json().catch(() => ({}))) as GowaBody };
    } catch (e) {
      return { error: `GOWA לא עונה: ${e instanceof Error ? e.message : 'שגיאת רשת'}` };
    }
  }

  async status(): Promise<WaStatus> {
    if (!waConfig()) return { configured: false };
    const r = await this.get('/app/status');
    if ('error' in r) return { configured: true, ok: false, error: r.error };
    if (r.status !== 200) return { configured: true, ok: false, error: gowaError(r.status, r.body) };
    const x = r.body.results ?? {};
    const jid = typeof x.jid === 'string' ? x.jid : '';
    return { configured: true, ok: true, connected: x.is_connected === true, loggedIn: x.is_logged_in === true,
             phone: jid ? normalizePhone(jid) : null };
  }

  async checkHealth(): Promise<HealthResult> {
    const s = await this.status();
    if (!s.configured) return { ok: false, error: NOT_CONFIGURED, state: 'not_configured' };
    if (!s.ok) return { ok: false, error: s.error, state: 'unreachable' };
    if (!s.loggedIn) return { ok: false, error: 'המספר לא מחובר (צריך לסרוק QR)', state: 'logged_out' };
    if (!s.connected) return { ok: false, error: 'מחובר למספר אבל לא לשרתי וואטסאפ', state: 'disconnected' };
    return { ok: true, dryRun: waDryRun() && !waTestPhone(), state: 'connected' };
  }

  async loginQr(): Promise<QrResult> {
    const cfg = waConfig();
    if (!cfg) return { ok: false, error: NOT_CONFIGURED, notConfigured: true };
    const r = await this.get('/app/login');
    if ('error' in r) return { ok: false, error: r.error };
    if (r.status !== 200) {
      const already = /already logged in/i.test(String(r.body.message ?? ''));
      return { ok: false, error: already ? 'המספר כבר מחובר' : gowaError(r.status, r.body), alreadyLoggedIn: already };
    }
    // ★ qr_link בנוי מהמארח שהבקשה הגיעה אליו — לא סומכים עליו. לוקחים רק את הנתיב, ומבקשים אותו
    //   מהכתובת שלנו עם הסיסמה. כך הסיסמה לא נשלחת לשום מקום אחר, והדפדפן מקבל רק תמונה.
    let path: string;
    try { path = new URL(String(r.body.results?.qr_link ?? '')).pathname; } catch { return { ok: false, error: 'GOWA לא החזירה קוד QR' }; }
    const base = new URL(cfg.baseUrl);
    const at = path.indexOf('/statics/');
    if (at < 0) return { ok: false, error: 'GOWA החזירה קוד QR בכתובת לא צפויה' };
    try {
      const img = await fetch(`${base.origin}${base.pathname.replace(/\/+$/, '')}${path.slice(at)}`,
        { headers: authHeaders(cfg), signal: AbortSignal.timeout(TIMEOUT_READ_MS) });
      const type = img.headers.get('content-type') ?? '';
      if (!img.ok || !type.startsWith('image/')) return { ok: false, error: `תמונת ה-QR לא נטענה (${img.status})` };
      const bytes = new Uint8Array(await img.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const d = Number(r.body.results?.qr_duration);
      return { ok: true, qrDataUrl: `data:${type.split(';')[0]};base64,${btoa(bin)}`, durationSec: Number.isFinite(d) ? d : null };
    } catch (e) {
      return { ok: false, error: `תמונת ה-QR לא נטענה: ${e instanceof Error ? e.message : 'שגיאת רשת'}` };
    }
  }

  async logout(): Promise<{ ok: true } | { ok: false; error: string; notConfigured?: boolean }> {
    if (!waConfig()) return { ok: false, error: NOT_CONFIGURED, notConfigured: true };
    const r = await this.get('/app/logout');
    if ('error' in r) return { ok: false, error: r.error };
    return r.status === 200 ? { ok: true } : { ok: false, error: gowaError(r.status, r.body) };
  }

  parseIncoming(payload: unknown): IncomingMessage | null {
    const e = parseWebhookEvent(payload);
    return e.kind === 'message' ? e.message : null;
  }
}

// ───────────────────── פרסור webhook של GOWA ─────────────────────

/**
 * מעטפת: { event, device_id, session_id, payload: { id, chat_id, from, from_name, sender_display_name,
 *          timestamp, is_from_me, body, … } }.
 * ★ בלי מזהה — לא מעבדים (מניעת כפילויות). הודעות שלי, קבוצות, סטטוסים וערוצים — מתעלמים.
 *   מזהה LID בלבד (בלי מספר) — אי אפשר לדעת מי השולחת: לא מעבדים, ומתריעים.
 */
export function parseWebhookEvent(input: unknown): WebhookEvent {
  if (!input || typeof input !== 'object') return { kind: 'unparsable', reason: 'not_object' };
  const root = input as Record<string, unknown>;
  const event = typeof root.event === 'string' ? root.event : '';
  if (event === 'device.logged_out') return { kind: 'device', state: 'logged_out', event };
  if (event === 'device.temporary_ban') return { kind: 'device', state: 'banned', event };
  if (event === 'device.reachout_timelock') return { kind: 'device', state: 'timelock', event };
  if (event !== 'message') return { kind: 'ignore', reason: `event:${event || 'none'}` };

  const p = (root.payload && typeof root.payload === 'object' ? root.payload : {}) as Record<string, unknown>;
  if (p.is_from_me === true) return { kind: 'ignore', reason: 'from_me' };
  const chat = typeof p.chat_id === 'string' ? p.chat_id : '';
  const from = typeof p.from === 'string' ? p.from.trim() : '';
  if (/@(g\.us|broadcast|newsletter)$/.test(chat) || /@(g\.us|broadcast|newsletter)$/.test(from)) {
    return { kind: 'ignore', reason: 'not_private_chat' };
  }
  const id = p.id === null || p.id === undefined ? '' : String(p.id).trim();
  if (!id) return { kind: 'unparsable', reason: 'no_id' };
  if (!from || !from.endsWith('@s.whatsapp.net')) return { kind: 'unparsable', reason: from.endsWith('@lid') ? 'lid_only' : 'no_sender' };
  const phone = normalizePhone(from);
  if (!/^\d{8,15}$/.test(phone)) return { kind: 'unparsable', reason: 'bad_sender' };
  const name = typeof p.sender_display_name === 'string' && p.sender_display_name ? p.sender_display_name
    : typeof p.from_name === 'string' && p.from_name ? p.from_name : null;
  return {
    kind: 'message',
    message: {
      providerMsgId: id,
      from: phone,
      body: typeof p.body === 'string' ? p.body : '',
      contactName: name,
      receivedAt: typeof p.timestamp === 'string' ? p.timestamp : new Date().toISOString(),
      raw: input,
    },
  };
}

// ───────────────────── אימות חתימת ה-webhook ─────────────────────

/**
 * ★ X-Hub-Signature-256: sha256=<hex>, HMAC-SHA256 של הגוף הגולמי עם WA_WEBHOOK_SECRET.
 *   מול הגוף הגולמי בדיוק (לא JSON שעבר פרסור). השוואה בזמן קבוע.
 *   ★ אין כאן שום פנייה למסד — הסוד רק ממשתנה הסביבה. בלי סוד — כלום לא מאומת.
 */
export async function verifyWebhookSignature(rawBody: string, header: string | null): Promise<boolean> {
  const secret = env('WA_WEBHOOK_SECRET');
  if (!secret || !header) return false;
  const got = header.trim().toLowerCase();
  if (!/^sha256=[0-9a-f]{64}$/.test(got)) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = 'sha256=' + Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('');
  let diff = expected.length ^ got.length;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ got.charCodeAt(i % got.length);
  return diff === 0;
}

export function whatsappProvider(): WhatsAppProvider {
  return new GowaProvider();
}
