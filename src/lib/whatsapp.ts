/**
 * ערוץ גיבוי: הודעת וואטסאפ דרך Green API (https://green-api.com). עובר דרך שער ההתראות.
 * לא מוגדר → no-op.
 */
import { canNotifyAt } from "./notify-gate";
import type { BlackoutReason } from "./hebrew-dates";

export function whatsappConfigured(): boolean {
  return Boolean(process.env.GREEN_API_ID_INSTANCE && process.env.GREEN_API_TOKEN && process.env.WHATSAPP_TO);
}

export interface WhatsAppResult {
  ok: boolean;
  error?: string;
  blocked?: boolean;
  reason?: BlackoutReason | null;
}

export async function sendWhatsApp(message: string, opts: { at?: Date } = {}): Promise<WhatsAppResult> {
  const gate = await canNotifyAt(opts.at ?? new Date());
  if (!gate.allowed) return { ok: false, blocked: true, reason: gate.reason, error: "blocked" };
  if (!whatsappConfigured()) return { ok: false, error: "not-configured" };
  const base = (process.env.GREEN_API_URL || "https://api.green-api.com").replace(/\/$/, "");
  const id = process.env.GREEN_API_ID_INSTANCE!;
  const token = process.env.GREEN_API_TOKEN!;
  const to = process.env.WHATSAPP_TO!.replace(/\D/g, "");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${base}/waInstance${id}/sendMessage/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId: `${to}@c.us`, message }),
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}
