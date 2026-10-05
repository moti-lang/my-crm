// sumit-probe — כלי גילוי זמני: מעביר קריאה ל-api.sumit.co.il עם פרטי ארגון
// הבדיקה ומחזיר את התשובה הגולמית. CRON_SECRET בלבד. לא נקרא מהאפליקציה.
// נמחק אחרי שהחוזה מתועד ב-docs/sumit-contract.md.
import { requireCronSecret } from '../_shared/guard.ts';
import { requireEnv } from '../_shared/env.ts';

Deno.serve(async (req) => {
  const denied = requireCronSecret(req);
  if (denied) return denied;
  const { path, payload, method, host, org } = await req.json() as { path: string; payload?: Record<string, unknown>; method?: string; host?: string; org?: 'test' | 'live' };
  // ברירת מחדל: ארגון הבדיקה. הארגון האמיתי רק כשמבקשים במפורש (org: 'live').
  const creds = org === 'live'
    ? { CompanyID: Number(requireEnv('SUMIT_COMPANY_ID')), APIKey: requireEnv('SUMIT_API_KEY') }
    : { CompanyID: Number(requireEnv('SUMIT_TEST_COMPANY_ID')), APIKey: requireEnv('SUMIT_TEST_API_KEY') };
  const body = { Credentials: creds, ...(payload ?? {}) };
  const t0 = Date.now();
  const res = await fetch(`https://${host ?? 'api.sumit.co.il'}${path}`, {
    method: method ?? 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, redirect: 'manual',
    body: method === 'GET' ? undefined : JSON.stringify(body),
  }).catch((e) => ({ status: 0, text: async () => String(e), headers: new Headers() } as unknown as Response));
  // ★ פרטי כרטיס ות"ז של הורים לא יוצאים מהפונקציה, גם לא לכלי הגילוי.
  const text = (await res.text())
    .replace(/"(CreditCard_Token|CreditCard_CitizenID|CreditCard_Number|CreditCard_Track2|CreditCard_CVV|CitizenID|DirectDebit_Account)"\s*:\s*"[^"]*"/g, '"$1":"<redacted>"');
  let json: unknown = null; try { json = JSON.parse(text); } catch { /* raw */ }
  return new Response(JSON.stringify({ status: res.status, ms: Date.now() - t0, contentType: res.headers.get('content-type'), json, raw: json ? undefined : text.slice(0, 2000) }), { headers: { 'content-type': 'application/json' } });
});
