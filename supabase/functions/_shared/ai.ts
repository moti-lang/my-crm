import { requireEnv, AI_DRY_RUN } from './env.ts';

export type AiResult = { ok: true; text: string; dryRun: boolean } | { ok: false; error: string };

/**
 * אדפטר Claude. אותו עיקרון כמו אדפטר הוואטסאפ:
 * AI_DRY_RUN=true מחזיר תשובה קבועה ולא נוגע ברשת ולא עולה כסף.
 * ai-command ו-ai-answer מדברים רק דרך הממשק הזה.
 */
export interface AiClient {
  complete(opts: {
    system: string;
    user: string;
    maxTokens: number;
    temperature: number;
  }): Promise<AiResult>;
}

class DryRunAiClient implements AiClient {
  async complete(opts: { system: string; user: string }): Promise<AiResult> {
    console.log(`[AI_DRY_RUN] system ${opts.system.length} תווים · user ${opts.user.length} תווים`);
    // תשובה נייטרלית ותקפה מבחינת סכימה, כדי שהזרימה למעלה תרוץ מקצה לקצה.
    return await Promise.resolve({
      ok: true,
      dryRun: true,
      text: JSON.stringify({
        intent: 'unknown',
        confidence: 0,
        fields: {},
        missing: [],
        human_summary: 'הרצה יבשה — אין חיבור ל-Claude',
      }),
    });
  }
}

class ClaudeClient implements AiClient {
  async complete(opts: {
    system: string;
    user: string;
    maxTokens: number;
    temperature: number;
  }): Promise<AiResult> {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': requireEnv('ANTHROPIC_API_KEY'),
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: opts.maxTokens,
          temperature: opts.temperature,
          system: opts.system,
          messages: [{ role: 'user', content: opts.user }],
        }),
      });
      if (!res.ok) return { ok: false, error: `Claude API ${res.status}` };
      const json = (await res.json()) as { content?: Array<{ text?: string }> };
      return { ok: true, text: json.content?.[0]?.text ?? '', dryRun: false };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'network error' };
    }
  }
}

export function aiClient(): AiClient {
  return AI_DRY_RUN ? new DryRunAiClient() : new ClaudeClient();
}
