/**
 * ערוץ גיבוי: הודעת וואטסאפ דרך Green API (https://green-api.com).
 * לא מוגדר → no-op.
 */
export function whatsappConfigured(): boolean {
  return Boolean(process.env.GREEN_API_ID_INSTANCE && process.env.GREEN_API_TOKEN && process.env.WHATSAPP_TO);
}

export async function sendWhatsApp(message: string): Promise<{ ok: boolean; error?: string }> {
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
