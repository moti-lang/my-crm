import { env, requireEnv, WA_DRY_RUN } from './env.ts';

export type SendResult = { ok: true; greenId: string | null; dryRun: boolean } | { ok: false; error: string };

/**
 * אדפטר וואטסאפ. כל הקוד שמעליו לא יודע אם ההודעה באמת יצאה.
 * המעבר מבדיקה לחי הוא WA_DRY_RUN=false בלבד — לא שכתוב.
 */
export interface WaClient {
  sendMessage(to: string, body: string): Promise<SendResult>;
}

class DryRunWaClient implements WaClient {
  async sendMessage(to: string, body: string): Promise<SendResult> {
    console.log(`[WA_DRY_RUN] היעד ${to} · ${body.length} תווים · לא נשלח`);
    return await Promise.resolve({ ok: true, greenId: null, dryRun: true });
  }
}

class GreenApiClient implements WaClient {
  async sendMessage(to: string, body: string): Promise<SendResult> {
    const base = env('GREEN_API_URL') ?? 'https://api.green-api.com';
    const id = requireEnv('GREEN_API_ID');
    const token = requireEnv('GREEN_API_TOKEN');
    try {
      const res = await fetch(`${base}/waInstance${id}/sendMessage/${token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chatId: `${to}@c.us`, message: body }),
      });
      if (!res.ok) return { ok: false, error: `Green API ${res.status}` };
      const json = (await res.json()) as { idMessage?: string };
      return { ok: true, greenId: json.idMessage ?? null, dryRun: false };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'network error' };
    }
  }
}

export function waClient(): WaClient {
  return WA_DRY_RUN ? new DryRunWaClient() : new GreenApiClient();
}
