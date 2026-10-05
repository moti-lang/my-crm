#!/usr/bin/env node
/**
 * גילוי החוזה של SUMIT מול ארגון הבדיקה, דרך sumit-probe (הסנדבוקס לא מגיע
 * ל-api.sumit.co.il; ה-Edge Function כן). כל קריאה מודפסת עם התשובה הגולמית,
 * ונשמרת ל-docs/sumit-contract.raw.json כראיה.
 *   node scripts/sumit-discover.mjs            # כל הסבבים
 *   node scripts/sumit-discover.mjs --one '/billing/payments/list/' '{"...":1}'
 * דורש: SUPABASE_PROJECT_REF, CRON_SECRET (ב-.env.verify או בסביבה).
 */
import { writeFileSync } from 'node:fs';
import { loadEnvFile } from './supabase-api.mjs';
loadEnvFile('.env.verify');
const ref = process.env.SUPABASE_PROJECT_REF, secret = process.env.CRON_SECRET;
if (!ref || !secret) { console.error('  ✗ חסרים SUPABASE_PROJECT_REF / CRON_SECRET'); process.exit(2); }
const log = [];
async function probe(label, path, payload, method = 'POST') {
  const res = await fetch(`https://${ref}.supabase.co/functions/v1/sumit-probe`, {
    method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ path, payload, method }),
  });
  const out = await res.json();
  log.push({ label, path, payload, ...out });
  console.log(`\n═══ ${label} — ${method} ${path} (HTTP ${out.status}, ${out.ms}ms)`);
  console.log('  →', JSON.stringify(payload));
  console.log('  ←', JSON.stringify(out.json ?? out.raw, null, 1).split('\n').slice(0, 60).join('\n     '));
  return out;
}
const ext = `tl-discover-${Date.now()}`;
const customer = { Name: 'בדיקה אוטומטית', Phone: '0500000000', EmailAddress: 'test@example.com', ExternalIdentifier: ext, SearchMode: 0 };
const item = { Item: { Name: 'שכר לימוד — בדיקה', Description: 'גילוי חוזה' }, Quantity: 1, UnitPrice: 210, TotalPrice: 210, Currency: 'ILS' };
const args = process.argv.slice(2);
if (args[0] === '--one') { await probe('ידני', args[1], JSON.parse(args[2] ?? '{}'), args[3] ?? 'POST'); process.exit(0); }

// ─── 1. beginredirect: גוף ריק → הודעת השגיאה אומרת מה חסר ───
await probe('beginredirect ריק', '/billing/payments/beginredirect/', {});
// ─── 2. beginredirect מלא לפי הספריות הפתוחות ───
const page = await probe('beginredirect מלא', '/billing/payments/beginredirect/', {
  Customer: customer, Items: [item], ExternalIdentifier: ext, RedirectURL: 'https://teichtal-crm.netlify.app/pay/x?returned=1',
  IPNURL: `https://${ref}.supabase.co/functions/v1/sumit-webhook`, Language: 0, VATIncluded: true, MaximumPayments: 1,
});
// ─── 3. שליפה: כמה מועמדים ───
for (const p of ['/billing/payments/list/', '/billing/payments/get/', '/billing/payments/getbyexternalidentifier/', '/billing/payments/search/']) {
  await probe(`שליפה ${p}`, p, { ExternalIdentifier: ext, PaymentID: null, StartDate: null });
}
// ─── 4. לקוח: מציאה לפי ExternalIdentifier ───
await probe('לקוח לפי ExternalIdentifier', '/accounting/customers/getbyexternalidentifier/', { ExternalIdentifier: ext });
await probe('לקוחות: רשימה', '/accounting/customers/list/', {});
// ─── 5. חיוב ישיר עם כרטיס דמה (מחליף את ההורה שמקלידה בדף) ───
await probe('charge: גוף ריק', '/billing/payments/charge/', {});
await probe('charge: כרטיס דמה', '/billing/payments/charge/', {
  Customer: customer, Items: [item], ExternalIdentifier: ext + '-charge', VATIncluded: true, Language: 0,
  PaymentMethod: { Type: 1, CreditCard_Number: '4580000000000000', CreditCard_ExpirationMonth: 12, CreditCard_ExpirationYear: 2030, CreditCard_CVV: '123', CreditCard_CitizenID: '000000000' },
});
writeFileSync('docs/sumit-contract.raw.json', JSON.stringify(log, null, 2));
console.log('\n  ✓ נשמר docs/sumit-contract.raw.json');
