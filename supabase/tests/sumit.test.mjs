#!/usr/bin/env node
/**
 * SUMIT (שלב א) — בלי מפתח, מול הספק המוקלט ומסד מזויף שמתעד כל כתיבה.
 * הטענות:
 *   ★ אישור תשלום מגיע רק מ-SUMIT: גוף webhook שאומר "שולם" לא רושם כלום
 *     בלי ש-getPaymentStatus אישרה. ★ אותה הודעה פעמיים → רישום אחד (המסד),
 *     והסנכרון לא כותב כשלא שולם. ★ SUMIT אומרת שולם והרישום נכשל → התראה.
 *   ★ הסוד המשותף: השוואה בזמן קבוע, סוד חסר/שגוי → 401.
 *   ★ הסכום לדף SUMIT מגיע מהרשומה שלנו, לא מהבקשה.
 *   npm run test:sumit
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codeOf } from './_code.mjs';

process.env.SUMIT_DRY_RUN = 'true';
process.env.SUMIT_WEBHOOK_SECRET = 'top-secret-1234';
const dir = mkdtempSync(join(tmpdir(), 'sumit-'));
const bundle = (src, name) => {
  const out = join(dir, name);
  execFileSync('npx', ['esbuild', src, '--bundle', '--format=esm', `--outfile=${out}`, '--log-level=error',
    '--define:Deno.env.get=__denoEnvGet', '--banner:js=const __denoEnvGet = (k) => process.env[k];']);
  return out;
};
const sumit = await import(bundle('supabase/functions/_shared/sumit.ts', 'sumit.mjs'));
const { syncPaymentLink } = await import(bundle('supabase/functions/_shared/sumit-sync.ts', 'sync.mjs'));
const guard = await import(bundle('supabase/functions/_shared/guard.ts', 'guard.mjs'));

let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`); };

function makeDb(rpcResult = { ok: true, duplicate: false, status: 'paid' }, rpcError = null) {
  const calls = [], inserts = [];
  return {
    calls, inserts,
    db: {
      rpc: async (fn, args) => { calls.push({ fn, args }); return { data: rpcResult, error: rpcError }; },
      from: (t) => ({ insert: async (row) => { inserts.push({ t, row }); return { error: null }; } }),
    },
  };
}
const provider = sumit.sumitProvider();

console.log('\nהספק המוקלט:');
{
  const page = await provider.createPaymentPage({ externalIdentifier: 'tl-1', amount: 1800, description: 'x', customerName: 'א', customerPhone: null, redirectUrl: 'https://x/pay/t?returned=1' });
  check('דף תשלום נוצר (הרצה יבשה)', page.ok && page.dryRun && page.url.startsWith(sumit.DRY_RUN_PAGE_URL));
  const s = await provider.getPaymentStatus('tl-1');
  check('טרם שולם → לא נמצא', s.ok && s.found === false);
  const paid = await provider.getPaymentStatus('tl-2-paid');
  check('*-paid → שולם', paid.ok && paid.found && paid.paid);
  const down = await provider.getPaymentStatus('tl-3-sumit-down');
  check('*-sumit-down → שגיאת ספק', !down.ok);
}

console.log('\nהסנכרון — רושם רק מה ש-SUMIT אישרה:');
{
  const { db, calls, inserts } = makeDb();
  await provider.createPaymentPage({ externalIdentifier: 'tl-a-paid', amount: 1800, description: 'x', customerName: 'א', customerPhone: null, redirectUrl: 'u' });
  const o = await syncPaymentLink(db, provider, { external_identifier: 'tl-a-paid', amount: 1800 });
  check('★ שולם ב-SUMIT → rpc_record_sumit_payment עם הערכים של SUMIT', o.result === 'recorded' && calls.length === 1 && calls[0].fn === 'rpc_record_sumit_payment'
        && calls[0].args.p_amount === 1800 && calls[0].args.p_sumit_payment_id === 'dry-tl-a-paid', JSON.stringify(calls));
  check('בלי התראה', inserts.length === 0);
}
{
  const { db, calls } = makeDb();
  const o = await syncPaymentLink(db, provider, { external_identifier: 'tl-b-unpaid', amount: 1800 });
  check('★ לא שולם → אפס כתיבות', o.result === 'unpaid' && calls.length === 0);
  const n = await syncPaymentLink(db, provider, { external_identifier: 'tl-c', amount: 1800 });
  check('לא נמצא → אפס כתיבות', n.result === 'not_found' && calls.length === 0);
  const e = await syncPaymentLink(db, provider, { external_identifier: 'tl-d-sumit-down', amount: 1800 });
  check('★ SUMIT לא זמינה → אפס כתיבות, לא "שולם" ולא "לא שולם"', e.result === 'provider_error' && calls.length === 0);
}
{
  const { db, inserts } = makeDb(null, { message: 'boom' });
  const o = await syncPaymentLink(db, provider, { external_identifier: 'tl-e-paid', amount: 100 });
  check('★ SUMIT אישרה והרישום נכשל → התראה קריטית, לא שקט', o.result === 'record_failed' && inserts.some((i) => i.t === 'system_alerts' && i.row.kind === 'sumit_record_failed' && i.row.severity === 'critical'));
}
{
  const { db, inserts } = makeDb({ ok: false, reason: 'no_link' });
  const o = await syncPaymentLink(db, provider, { external_identifier: 'tl-f-paid', amount: 100 });
  check('תשלום בלי קישור אצלנו → התראה', o.result === 'record_failed' && inserts.length === 1);
}
{
  const { db, calls } = makeDb({ ok: true, duplicate: true, status: 'paid' });
  const o = await syncPaymentLink(db, provider, { external_identifier: 'tl-g-paid', amount: 100 });
  check('כפילות (המסד אומר duplicate) — מדווח, לא נכשל', o.result === 'recorded' && o.duplicate === true && calls.length === 1);
}

console.log('\nה-webhook — רמז בלבד:');
{
  const ext = 'tl-12345678-1234-1234-1234-123456789abc';
  check('JSON', sumit.extractExternalIdentifier('application/json', JSON.stringify({ Folder: 'Payments', ExternalIdentifier: ext })) === ext);
  check('JSON מקונן', sumit.extractExternalIdentifier('application/json', JSON.stringify({ Properties: { External_Identifier: [ext] } })) === ext);
  check('טופס', sumit.extractExternalIdentifier('application/x-www-form-urlencoded', `EntityID=5&ExternalIdentifier=${ext}`) === ext);
  check('מעטפת json=', sumit.extractExternalIdentifier('application/x-www-form-urlencoded', `json=${encodeURIComponent(JSON.stringify({ ExternalIdentifier: ext }))}`) === ext);
  check('★ מזהה שאינו בפורמט שלנו — נדחה (אין "רמז" חופשי)', sumit.extractExternalIdentifier('application/json', JSON.stringify({ ExternalIdentifier: "'; drop table x; --" })) === null);
  check('גוף שבור → null, לא קריסה', sumit.extractExternalIdentifier('application/json', '{bad') === null);
}
{
  const src = codeOf('supabase/functions/sumit-webhook/index.ts');
  check('★ ה-webhook לא רושם תשלום בעצמו — רק דרך syncPaymentLink (שואל את SUMIT קודם)', !/rpc_record_sumit_payment/.test(src) && /syncPaymentLink\(/.test(src));
  check('★ ה-webhook לא מפרסר את הגוף בעצמו ולא קורא ממנו "שולם"/סכום', !/JSON\.parse|ValidPayment|\.paid\b|\.amount\b/.test(src.replace(/\/\/.*$/gm, '')));
  const sync = codeOf('supabase/functions/_shared/sumit-sync.ts');
  check('★ הסנכרון רושם רק אחרי getPaymentStatus שאמרה paid', /getPaymentStatus\(/.test(sync) && /if \(!status\.paid\) return/.test(sync));
  const checkout = codeOf('supabase/functions/sumit-checkout/index.ts');
  check('★ הסכום לדף SUMIT מגיע מהרשומה (link.amount), לא מהבקשה', /amount: Number\(link\.amount\)/.test(checkout) && !/req\.json\(\)/.test(checkout));
  check('כתובת החזרה מ-SUMIT היא "בודקים", עם returned=1', /\?returned=1/.test(checkout));
}

console.log('\nהסוד המשותף:');
{
  const mk = (h) => new Request('https://x/sumit-webhook', { method: 'POST', headers: h });
  check('★ בלי סוד → 401', (await guard.requireSharedSecret(mk({}), 'SUMIT_WEBHOOK_SECRET'))?.status === 401);
  check('★ סוד שגוי → 401', (await guard.requireSharedSecret(mk({ 'x-webhook-secret': 'top-secret-1235' }), 'SUMIT_WEBHOOK_SECRET'))?.status === 401);
  check('סוד באורך אחר → 401', (await guard.requireSharedSecret(mk({ 'x-webhook-secret': 'x' }), 'SUMIT_WEBHOOK_SECRET'))?.status === 401);
  check('סוד נכון → עובר', (await guard.requireSharedSecret(mk({ 'x-webhook-secret': 'top-secret-1234' }), 'SUMIT_WEBHOOK_SECRET')) === null);
  check('constantTimeEqual: ריק לעולם לא שווה', (await guard.constantTimeEqual('', '')) === false);
  check('requirePayToken: טוקן קצר/לא הקס נדחה', guard.requirePayToken(new Request('https://x/f?token=abc'))?.status === 401 && guard.requirePayToken(new Request(`https://x/f?token=${'a'.repeat(64)}`)) === null);
}

console.log(fails === 0 ? '\nSUMIT: כל הטענות עברו' : `\n${fails} בדיקות נכשלו`);
process.exit(fails ? 1 : 0);
