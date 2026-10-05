// sumit-probe — כלי גילוי זמני: מעביר קריאה ל-api.sumit.co.il עם פרטי ארגון
// הבדיקה ומחזיר את התשובה הגולמית. CRON_SECRET בלבד. לא נקרא מהאפליקציה.
// נמחק אחרי שהחוזה מתועד ב-docs/sumit-contract.md.
import { requireCronSecret } from '../_shared/guard.ts';
import { requireEnv } from '../_shared/env.ts';

Deno.serve(async (req) => {
  const denied = requireCronSecret(req);
  if (denied) return denied;
  const { path, payload, method } = await req.json() as { path: string; payload?: Record<string, unknown>; method?: string };
  const body = { Credentials: { CompanyID: Number(requireEnv('SUMIT_COMPANY_ID')), APIKey: requireEnv('SUMIT_API_KEY') }, ...(payload ?? {}) };
  const t0 = Date.now();
  const res = await fetch(`https://api.sumit.co.il${path}`, {
    method: method ?? 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  }).catch((e) => ({ status: 0, text: async () => String(e), headers: new Headers() } as unknown as Response));
  const text = await res.text();
  let json: unknown = null; try { json = JSON.parse(text); } catch { /* raw */ }
  return new Response(JSON.stringify({ status: res.status, ms: Date.now() - t0, contentType: res.headers.get('content-type'), json, raw: json ? undefined : text.slice(0, 2000) }), { headers: { 'content-type': 'application/json' } });
});
