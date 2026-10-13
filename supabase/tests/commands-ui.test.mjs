#!/usr/bin/env node
/**
 * ★ מסך "פקודות וואטסאפ" מחובר למנוע — לא ממשק ריק.
 *
 * דפדפן אמיתי + PostgREST אמיתי מול המסד המקומי. צ'אט הבדיקה מריץ את הקוד של
 * wa-command-test עצמו (runTestMessage → routeIncoming: אותו נתב ש-wa-webhook מריץ),
 * כ-service_role מול אותו מסד, עם הפענוח המוקלט (AI_DRY_RUN). מה שנבדק הוא השרשרת:
 *   הוספת מספר במסך → הודעה בצ'אט → כרטיס אישור → "כן" → הוצאה במסד → היומן →
 *   "ביטול" במסך → ההוצאה הוסרה. וגם: ניסיון שנדחה בהרשאות מופיע ביומן באדום.
 *   node supabase/tests/commands-ui.test.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgrestClient } from '@supabase/postgrest-js';
import { reporter, screenState, signJwt, sql, startUi } from './_ui.mjs';
import { codeOf } from './_code.mjs';

process.env.AI_DRY_RUN = 'true';
const dir = mkdtempSync(join(tmpdir(), 'cmd-ui-'));
const out = join(dir, 'command-test.mjs');
execFileSync('npx', ['esbuild', 'supabase/functions/_shared/command-test.ts', '--bundle', '--format=esm', `--outfile=${out}`,
  '--log-level=error', '--define:Deno.env.get=__denoEnvGet', '--banner:js=const __denoEnvGet = (k) => process.env[k];']);
const { runTestMessage } = await import(out);

const OWNER = 'cccccccc-0000-0000-0000-000000000001';
const MODIIN = sql(`select id from branches where name = 'מודיעין עילית'`);
const ALL_PHONE = '972507770101', BRANCH_PHONE = '972507770102';
const cleanup = () => sql(`
  delete from ledger_entries where id in (select result_id from commands where phone in ('${ALL_PHONE}', '${BRANCH_PHONE}') and result_table = 'ledger_entries');
  delete from audit_log where actor in ('${ALL_PHONE}', '${BRANCH_PHONE}') or (action = 'cancel_command' and row_id in (select id from commands where phone in ('${ALL_PHONE}', '${BRANCH_PHONE}')));
  delete from commands where phone in ('${ALL_PHONE}', '${BRANCH_PHONE}');
  delete from authorized_numbers where phone in ('${ALL_PHONE}', '${BRANCH_PHONE}')`);
const until = async (q, want, ms = 10000) => {
  const t0 = Date.now();
  for (;;) { const v = sql(q); if (v === want || Date.now() - t0 > ms) return v; await new Promise((r) => setTimeout(r, 200)); }
};

const { check, failed } = reporter();

console.log('\nהפונקציה wa-command-test (בקוד):');
{
  const fn = codeOf('supabase/functions/wa-command-test/index.ts');
  const core = codeOf('supabase/functions/_shared/command-test.ts');
  const ownerAt = fn.search(/rpc\('auth_role'\)[\s\S]{0,40}\n\s*if \(role !== 'owner'\) return json\(/);
  check('★ בעלים בלבד — הבדיקה לפני כל הרצה של המנוע', ownerAt !== -1 && ownerAt < fn.indexOf('runTestMessage('));
  check('★ מריץ את הנתב האמיתי (routeIncoming), לא העתק', /await routeIncoming\(db, deps, \{ phone, body: text, channel: 'test' \}\)/.test(core));
  check('★ לא שולח וואטסאפ: אין ספק וואטסאפ ואין deliverReply', ![fn, core].some((c) => /whatsappProvider|deliverReply|sendText/.test(c)));
}
cleanup();
const ui = await startUi();
try {
  // צ'אט הבדיקה: הקוד האמיתי של הפונקציה, כ-service_role (כמו adminClient בענן).
  const service = new PostgrestClient(ui.rest, { headers: { Authorization: `Bearer ${signJwt({ role: 'service_role' })}` } });
  const calls = [];
  const functions = { 'wa-command-test': async (body) => { calls.push(body); return runTestMessage(service, { alert: async () => {} }, body); } };
  const { page, log } = await ui.newPage(OWNER, { functions });
  page.on('dialog', (d) => void d.accept());

  console.log('\nהמסך:');
  await page.goto(`${ui.app}/commands`, { waitUntil: 'domcontentloaded' });
  await page.locator('h1').first().waitFor({ timeout: 15000 }).catch(() => undefined);
  const s = await screenState(page);
  check('★ המסך נטען (פקודות וואטסאפ), בלי קריסה ובלי שגיאת טעינה', s.h1 === 'פקודות וואטסאפ' && !s.crashed && !s.loadError, s.details || s.h1);
  check('★ אין עוד "נבנה בסבב 6"', (await page.getByText(/נבנה בסבב|סבב 6/).count()) === 0);

  console.log('\nמספרים מורשים:');
  const form = page.getByRole('form', { name: 'הוספת מספר מורשה' });
  await form.getByLabel('שם', { exact: true }).fill('בדיקת מסך');
  await form.getByLabel('טלפון', { exact: true }).fill('050-777-0101');
  await form.getByRole('button', { name: 'הוספה' }).click();
  await page.getByTestId('authorized-number').filter({ hasText: 'בדיקת מסך' }).waitFor({ timeout: 10000 }).catch(() => undefined);
  check('★ מספר שנוסף במסך נשמר מנורמל (972…), ברמה "הכול"',
    await until(`select scope from authorized_numbers where phone = '${ALL_PHONE}'`, 'all') === 'all',
    `${(await page.getByRole('alert').allInnerTexts()).join(' | ')} ${log.badResponses.join(' ')}`);
  check('...ומופיע ברשימה עם הטלפון בפורמט מקומי', (await page.getByTestId('authorized-number').filter({ hasText: '050-777-0101' }).count()) === 1);

  await form.getByLabel('שם', { exact: true }).fill('כפול');
  await form.getByLabel('טלפון', { exact: true }).fill('+972 50 777 0101');
  await form.getByRole('button', { name: 'הוספה' }).click();
  check('★ אותו מספר שוב — "כבר ברשימה"', await page.getByText('המספר הזה כבר ברשימה').waitFor({ timeout: 5000 }).then(() => true, () => false));

  await form.getByLabel('שם', { exact: true }).fill('סניף מודיעין (בדיקה)');
  await form.getByLabel('טלפון', { exact: true }).fill('0507770102');
  await form.getByLabel('רמת הרשאה', { exact: true }).selectOption('branch');
  await form.getByLabel('סניף', { exact: true }).selectOption(MODIIN);
  await form.getByRole('button', { name: 'הוספה' }).click();
  check('★ מספר של סניף נשמר עם רמה "סניף" ועם הסניף שנבחר',
    await until(`select scope || ':' || branch_id from authorized_numbers where phone = '${BRANCH_PHONE}'`, `branch:${MODIIN}`) === `branch:${MODIIN}`);

  console.log("\nצ'אט בדיקה — המנוע האמיתי:");
  await page.getByRole('button', { name: "צ'אט בדיקה" }).click();
  await page.getByLabel('שולחת בשם').selectOption(ALL_PHONE);
  await page.getByLabel('פקודה').fill('שילמתי 860 תלבושות בביתר');
  await page.getByRole('button', { name: 'שליחה' }).click();
  const card = page.getByTestId('bot-turn').filter({ hasText: 'זיהיתי הוצאה' });
  check('★ כרטיס אישור מהנתב (₪860, ביתר עילית, "לאישור השיבי: כן")',
    await card.waitFor({ timeout: 10000 }).then(async () => /₪860/.test(await card.innerText()) && /ביתר עילית/.test(await card.innerText()), () => false));
  check('★ נוצרה פקודה ממתינה במסד, מסומנת "צ\'אט בדיקה" — ועוד לא נרשם כלום',
    sql(`select string_agg(status || ':' || channel, ',') from commands where phone = '${ALL_PHONE}'`) === 'pending_confirm:test'
    && sql(`select count(*) from ledger_entries where amount = 860 and source = 'whatsapp' and deleted_at is null`) === '0');
  check('הצ\'אט שלח לפונקציה את המספר שנבחר והטקסט', calls[0]?.phone === ALL_PHONE && calls[0]?.text === 'שילמתי 860 תלבושות בביתר');

  await page.getByRole('button', { name: 'כן', exact: true }).click();
  check('★ "כן" → "✅ נרשם"', await page.getByTestId('bot-turn').filter({ hasText: '✅ נרשם' }).waitFor({ timeout: 10000 }).then(() => true, () => false));
  check('★ ההוצאה נרשמה במסד דרך rpc_execute_command (860, ממקור וואטסאפ)',
    await until(`select count(*) from ledger_entries l join commands c on c.result_id = l.id where c.phone = '${ALL_PHONE}' and l.amount = 860 and l.deleted_at is null and c.status = 'applied'`, '1') === '1');

  await page.getByLabel('שולחת בשם').selectOption(BRANCH_PHONE);
  await page.getByLabel('פקודה').fill('שילמתי 860 תלבושות בביתר');
  await page.getByRole('button', { name: 'שליחה' }).click();
  check('★ מספר של סניף מודיעין לא רשאי בביתר — הבוט מסרב',
    await page.getByTestId('bot-turn').filter({ hasText: 'רק בסניף מודיעין עילית' }).waitFor({ timeout: 10000 }).then(() => true, () => false));
  check('★ הניסיון נרשם במסד כ"נדחה"', sql(`select string_agg(status::text, ',') from commands where phone = '${BRANCH_PHONE}'`) === 'rejected');

  console.log('\nיומן הפקודות:');
  await page.getByRole('button', { name: 'יומן פקודות' }).click();
  const rejected = page.locator('[data-testid="command-row"][data-status="rejected"]').filter({ hasText: 'סניף מודיעין (בדיקה)' });
  await rejected.first().waitFor({ timeout: 10000 }).catch(() => undefined);
  check('★ הניסיון שנדחה מופיע ביומן: מי, מה כתב, והסיבה',
    (await rejected.count()) === 1 && /שילמתי 860 תלבושות בביתר/.test(await rejected.innerText()) && /רק בסניף מודיעין עילית/.test(await rejected.innerText()));
  check('★ ...באדום', /bg-bad/.test((await rejected.getAttribute('class')) ?? ''));
  const applied = page.locator('[data-testid="command-row"][data-status="applied"]').filter({ hasText: 'בדיקת מסך' });
  check("הפעולה שבוצעה מופיעה עם 'בוצע' ותג צ'אט בדיקה", (await applied.count()) === 1 && /בוצע/.test(await applied.innerText()) && /צ'אט בדיקה/.test(await applied.innerText()));

  await applied.getByRole('button', { name: 'ביטול' }).click();
  check('★ "ביטול" במסך → ההוצאה הוסרה מהמסד (אותו היפוך כמו "בטל" בוואטסאפ)',
    await until(`select count(*) from ledger_entries l join commands c on c.result_id = l.id where c.phone = '${ALL_PHONE}' and l.deleted_at is not null and c.status = 'cancelled'`, '1') === '1');
  check('...והשורה ביומן מסומנת "בוטל" בלי כפתור ביטול',
    await page.locator('[data-testid="command-row"][data-status="cancelled"]').filter({ hasText: 'בדיקת מסך' }).waitFor({ timeout: 8000 })
      .then(async () => (await page.locator('[data-testid="command-row"][data-status="cancelled"]').filter({ hasText: 'בדיקת מסך' }).getByRole('button', { name: 'ביטול' }).count()) === 0, () => false));

  // פעולה מלפני יותר מ-24 שעות: מוצגת, אבל בלי כפתור ביטול.
  const oldCmd = sql(`select rpc_create_pending_command('${ALL_PHONE}', 'תוסיפי הכנסה 5000 חסויות',
    '{"intent":"income","confidence":0.9,"fields":{"amount":5000,"category":"חסויות"},"missing":[],"human_summary":"הכנסה ישנה של 5000"}'::jsonb, 'income')`);
  sql(`select rpc_execute_command('${oldCmd}'); update commands set created_at = now() - interval '25 hours' where id = '${oldCmd}'`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'יומן פקודות' }).click();
  const old = page.locator('[data-testid="command-row"][data-status="applied"]').filter({ hasText: 'הכנסה ישנה של 5000' });
  await old.first().waitFor({ timeout: 10000 }).catch(() => undefined);
  check('★ פעולה מלפני יותר מ-24 שעות — בלי כפתור ביטול', (await old.count()) === 1 && (await old.getByRole('button', { name: 'ביטול' }).count()) === 0);

  console.log('\nהשבתה:');
  await page.getByRole('button', { name: 'מספרים מורשים' }).click();
  await page.getByTestId('authorized-number').filter({ hasText: 'בדיקת מסך' }).getByRole('button', { name: 'השבתה' }).click();
  check('★ השבתה במסך → is_active=false במסד', await until(`select is_active from authorized_numbers where phone = '${ALL_PHONE}'`, 'f') === 'f');
  await page.getByRole('button', { name: "צ'אט בדיקה" }).click();
  const options = await page.getByLabel('שולחת בשם').locator('option').evaluateAll((os) => os.map((o) => o.value));
  check('★ מספר מושבת לא מוצע בצ\'אט', !options.includes(ALL_PHONE) && options.includes(BRANCH_PHONE), options.join(','));
  const inactive = await runTestMessage(service, { alert: async () => {} }, { phone: ALL_PHONE, text: 'שילמתי 860 תלבושות בביתר' });
  check('★ גם בשרת: מספר מושבת נדחה לפני הנתב (לא נוצרת פקודה)', inactive.ok === false
    && sql(`select count(*) from commands where phone = '${ALL_PHONE}' and status = 'pending_confirm'`) === '0');

  // (ה-409 על המספר הכפול הוא הבדיקה עצמה — לא תקלה.)
  const unexpected = log.badResponses.filter((r) => !(r.includes('/authorized_numbers') && r.includes('23505')));
  check('אף שאילתה לא נדחתה ע"י PostgREST (מלבד הכפול המכוון) ואין שגיאות JS', unexpected.length === 0 && log.pageErrors.length === 0,
    [...unexpected, ...log.pageErrors].join('\n'));
} finally {
  await ui.stop();
  cleanup();
}
console.log(failed() === 0 ? '\nמסך הפקודות מחובר למנוע — כל הבדיקות עברו' : `\n${failed()} בדיקות נכשלו`);
process.exit(failed() ? 1 : 0);
