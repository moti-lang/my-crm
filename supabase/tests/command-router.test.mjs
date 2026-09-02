#!/usr/bin/env node
/**
 * חבילת הנתב — רצה **בלי מפתח Anthropic**, מול פלטים מוקלטים.
 *
 * הטענה המרכזית שנבדקת כאן: מסלול כישלון הפרסור אינו כותב למסד.
 * הראיה אינה קריאת הקוד אלא מסד מזויף שמתעד כל קריאה, וכל כתיבה
 * שתתרחש בו תופיע ברשימה ותפיל את הבדיקה.
 *
 * הרצה:  npm run test:router
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AI_DRY_RUN = 'true';   // ברירת המחדל ממילא, מפורש לבהירות

const dir = mkdtempSync(join(tmpdir(), 'router-'));
const out = join(dir, 'router.mjs');
execFileSync('npx', ['esbuild', 'supabase/functions/_shared/router.ts', '--bundle', '--format=esm',
  `--outfile=${out}`, '--log-level=error', '--define:Deno.env.get=__denoEnvGet',
  '--banner:js=const __denoEnvGet = (k) => process.env[k];'], { stdio: 'inherit' });

const { routeIncoming } = await import(out);

let fails = 0;
const check = (label, ok, detail = '') => {
  if (!ok) fails++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
};

// ─────────────────── מסד מזויף שמתעד כל פעולה ───────────────────
const WRITE_OPS = ['insert', 'update', 'upsert', 'delete'];

function makeDb(rows) {
  const writes = [];
  const reads = [];
  const build = (table) => {
    const chain = {};
    for (const op of ['select', 'eq', 'is', 'gte', 'lte', 'order', 'limit', 'contains']) {
      chain[op] = () => chain;
    }
    chain.maybeSingle = async () => ({ data: rows[table]?.single ?? null, error: null });
    chain.then = (resolve) => resolve({ data: rows[table]?.list ?? [], error: null });
    // כתיבות מתועדות ומחזירות את השרשרת, כדי ש-.update().eq() יעבוד
    // כמו ב-supabase-js האמיתי.
    for (const op of WRITE_OPS) {
      chain[op] = (payload) => {
        writes.push({ table, op, payload });
        return chain;
      };
    }
    reads.push(table);
    return chain;
  };
  const rpcCalls = [];
  return {
    db: {
      from: build,
      rpc: async (name, args) => {
        rpcCalls.push({ name, args });
        writes.push({ table: `rpc:${name}`, op: 'rpc', payload: args });
        return { data: rows.__rpc?.[name] ?? null, error: null };
      },
    },
    writes, reads, rpcCalls,
  };
}

const BRANCHES = { list: [{ name: 'ביתר עילית' }, { name: 'מודיעין עילית' }] };
const STUDENTS = { list: [{ full_name: 'שירה כהן', branch_name: 'ביתר עילית' }] };
const CATEGORIES = { list: [{ name: 'תלבושות' }, { name: 'שכירות אולם' }] };

const owner = {
  phone: '972501234567', label: 'הניה (אישי)', scope: 'all',
  branch_id: null, can_delete: true, is_active: true, branches: null,
};
const financeUser = { ...owner, phone: '972533333333', label: 'שרה', scope: 'finance', can_delete: false };
const branchUser = {
  ...owner, phone: '972521111111', label: 'רבקי', scope: 'branch', can_delete: false,
  branch_id: 'b1', branches: { name: 'ביתר עילית' },
};

const base = (caller) => ({
  authorized_numbers: { single: caller },
  branches: BRANCHES, v_student_overview: STUDENTS, categories: CATEGORIES,
});

const alerts = [];
const deps = { alert: async (a) => { alerts.push(a); } };

async function route(caller, body, extra = {}) {
  const { db, writes, rpcCalls } = makeDb({ ...base(caller), ...extra });
  const decision = await routeIncoming(db, deps, { phone: caller?.phone ?? '972500000000', body });
  return { decision, writes, rpcCalls };
}

// ═════════════ 1. פרסור מוצלח ═════════════
console.log('\nפרסור מוצלח:');
{
  const { decision, writes } = await route(owner, 'שילמתי 860 תלבושות בביתר');
  check('הודעה ממספר מורשה מנותבת למסלול הפקודות', decision.route === 'command');
  check('הכוונה זוהתה כהוצאה', decision.parse.command?.intent === 'expense');
  check('הסכום חולץ', decision.parse.command?.fields?.amount === 860);
  check('הפעולה מאושרת לבעלים', decision.authorized?.allowed === true);
  check('פעולת כתיבה דורשת אישור', decision.needsConfirmation === true);
  // הכתיבה היחידה המותרת כאן היא שמירת הפקודה הממתינה עצמה.
  check('★ הכתיבה היחידה היא הפקודה הממתינה',
        writes.length === 1 && writes[0].table === 'rpc:rpc_create_pending_command',
        `נרשמו כתיבות: ${JSON.stringify(writes)}`);
}
{
  const { decision } = await route(owner, 'מי חייבת בביתר');
  check('שאילתה מזוהה', decision.parse.command?.intent === 'query');
  check('שאילתה אינה דורשת אישור', decision.needsConfirmation === false);
}

// ═════════════ 1ב. עטיפה שאינה כישלון ═════════════
// המודל אינו מחויב ל-JSON נקי: ה-API דוחה את הסכימה שלנו כ-output_config
// והמודל אינו תומך ב-prefill. לכן גדר markdown סביב פקודה תקינה חייבת
// להתקבל — אחרת פקודה כשרה של הניה נזרקת בגלל שלושה תווים.
{
  const { decision } = await route(owner, '__FIXTURE_MARKDOWN_WRAPPED__');
  check('★ JSON עטוף ב-markdown מתקבל', decision.route !== 'command_parse_failed',
        `התקבל: ${decision.route}`);
  check('★ ה-intent שרד את החילוץ', decision.parse?.command?.intent === 'expense',
        `התקבל: ${JSON.stringify(decision.parse?.command?.intent)}`);
}

// ═════════════ 2. ★ מסלולי כישלון — אפס כתיבות ═════════════
console.log('\n★ מסלולי כישלון הפרסור:');
const FAILURES = [
  ['JSON פגום',                '__FIXTURE_MALFORMED_JSON__',           'invalid_json'],
  ['תשובה שאינה JSON',          '__FIXTURE_NOT_JSON__',                 'invalid_json'],
  // ★ גדר סביב JSON שבור עדיין נכשלת. החילוץ מסיר עטיפה, לא מתקן תוכן.
  ['גדר סביב JSON שבור',        '__FIXTURE_MARKDOWN_BROKEN__',          'invalid_json'],
  ['שדות חסרים',                '__FIXTURE_MISSING_FIELDS__',           'schema_mismatch'],
  ['intent שאינו בסכימה',       '__FIXTURE_BAD_INTENT__',               'schema_mismatch'],
  ['confidence מחוץ לטווח',      '__FIXTURE_CONFIDENCE_OUT_OF_RANGE__',  'schema_mismatch'],
  ['תשובה ריקה',                '__FIXTURE_EMPTY__',                    'invalid_json'],
  ['intent=unknown',            'מה שלומך',                             'low_confidence'],
  ['טקסט לא מוכר',              'סתם משהו אקראי לגמרי',                  'low_confidence'],
  // ★ כוונה תקפה עם ביטחון נמוך — בודק את MIN_CONFIDENCE עצמו,
  //   ולא את הבדיקה הנפרדת של intent='unknown'.
  ['★ כוונה תקפה, ביטחון 0.4',  '__FIXTURE_LOW_CONFIDENCE__',           'low_confidence'],
  ['★ ביטחון 0.59 (רגע מתחת)',  '__FIXTURE_JUST_UNDER_THRESHOLD__',     'low_confidence'],
];

for (const [label, text, expectedReason] of FAILURES) {
  const { decision, writes } = await route(owner, text);
  check(`${label} → מסומן ככישלון`, decision.route === 'command_parse_failed');
  check(`${label} → סיבה: ${expectedReason}`, decision.parse.reason === expectedReason,
        `התקבל: ${decision.parse.reason}`);
  check(`★ ${label} → אפס כתיבות למסד`, writes.length === 0,
        `נרשמו כתיבות: ${JSON.stringify(writes)}`);
}

// גבול הסף: 0.6 בדיוק כן עובר
{
  const { decision } = await route(owner, '__FIXTURE_JUST_OVER_THRESHOLD__');
  check('★ ביטחון 0.6 בדיוק כן מתקבל', decision.route === 'command',
        `התקבל: ${decision.route} (${decision.parse?.reason ?? ''})`);
}

// ═════════════ 3. הרשאות ═════════════
console.log('\nבדיקות הרשאה:');
{
  const { decision } = await route(financeUser, 'תמחקי את שירה כהן');
  check('★ scope=finance אינו רשאי למחוק', decision.authorized?.allowed === false);
  check('הסיבה מדויקת', ['scope_finance', 'delete_denied'].includes(decision.authorized?.reason));
  check('ההודעה בעברית ולא ז׳רגון', /[א-ת]/.test(decision.authorized?.message ?? ''));
}
{
  const { decision } = await route(financeUser, 'שילמתי 860 תלבושות בביתר');
  check('scope=finance כן רשאי לרשום הוצאה', decision.authorized?.allowed === true);
}
{
  const { decision } = await route(owner, 'תמחקי את שירה כהן');
  check('בעלים עם can_delete כן רשאי למחוק', decision.authorized?.allowed === true);
}
{
  const { decision } = await route(branchUser, 'שילמתי 860 תלבושות בביתר');
  check('מנהלת סניף רשאית בסניף שלה', decision.authorized?.allowed === true);
}
{
  const db = base(branchUser);
  const { db: fake } = makeDb(db);
  // פקודה שנוקבת בסניף אחר
  const decision = await routeIncoming(fake, deps, {
    phone: branchUser.phone, body: 'תוסיפי הכנסה 5000 חסויות',
  });
  // ההקלטה מחזירה branch=null, ולכן זה מותר — הבדיקה החוצה-סניף
  // נעשית ישירות מול authorizeCommand בהמשך.
  check('פקודה ללא סניף מיוחסת לסניף של השולחת', decision.authorized?.allowed === true);
}

// ═════════════ 4. allowlist — מספר לא מורשה ═════════════
console.log('\nמספר לא מורשה:');
{
  alerts.length = 0;
  const { db, writes } = makeDb({ authorized_numbers: { single: null } });
  const decision = await routeIncoming(db, deps, { phone: '972509999999', body: 'תרשמי הוצאה 500' });
  check('מנותב למסלול הלקוחות', decision.route === 'customer');
  check('★ הניסיון סומן כפקודה', decision.rejectedAttempt === true);
  check('★ נרשם ב-commands עם status=rejected',
        writes.some((w) => w.table === 'commands' && w.op === 'insert' && w.payload.status === 'rejected'));
  check('★ נשלחה התראה לבעלים', alerts.some((a) => a.kind === 'unauthorized_command'));
}
{
  alerts.length = 0;
  const { db, writes } = makeDb({ authorized_numbers: { single: null } });
  const decision = await routeIncoming(db, deps, { phone: '972509999999', body: 'שלום, כמה עולה החוג?' });
  check('שאלה רגילה ממספר לא מוכר עוברת ללקוחות', decision.route === 'customer');
  check('★ שאלה רגילה אינה נרשמת כניסיון פקודה', decision.rejectedAttempt === false);
  check('★ שאלה רגילה אינה כותבת ל-commands', writes.length === 0,
        `נרשמו כתיבות: ${JSON.stringify(writes)}`);
  check('★ שאלה רגילה אינה מייצרת התראה', alerts.length === 0);
}

// ═════════════ 5. מטריצת ההרשאות, ישירות ═════════════
console.log('\nמטריצת ההרשאות:');
{
  const authOut = join(dir, 'authorize.mjs');
  execFileSync('npx', ['esbuild', 'supabase/functions/_shared/authorize.ts', '--bundle',
    '--format=esm', `--outfile=${authOut}`, '--log-level=error'], { stdio: 'inherit' });
  const { authorizeCommand, looksLikeCommand } = await import(authOut);

  const cmd = (intent, fields = {}) => ({ intent, confidence: 0.9, fields, missing: [], human_summary: '' });
  const num = (over) => ({ phone: '9725', label: 'x', scope: 'all', branch_id: null,
                           branch_name: null, can_delete: false, is_active: true, ...over });

  const M = [
    ['all · הוצאה',                num({}),                                       cmd('expense'),                       true],
    ['all · מחיקה בלי can_delete',  num({}),                                       cmd('update_student', { value: 'deleted' }), false],
    ['all · מחיקה עם can_delete',   num({ can_delete: true }),                     cmd('update_student', { value: 'deleted' }), true],
    ['finance · הוצאה',            num({ scope: 'finance' }),                     cmd('expense'),                       true],
    ['finance · תשלום',            num({ scope: 'finance' }),                     cmd('payment'),                       true],
    ['finance · שאילתה',           num({ scope: 'finance' }),                     cmd('query'),                         true],
    ['finance · תלמידה חדשה',      num({ scope: 'finance' }),                     cmd('new_student'),                   false],
    ['finance · נוכחות',           num({ scope: 'finance' }),                     cmd('attendance'),                    false],
    ['branch · הסניף שלה',         num({ scope: 'branch', branch_id: 'b1', branch_name: 'ביתר עילית' }), cmd('expense', { branch: 'ביתר עילית' }),   true],
    ['★ branch · סניף אחר',        num({ scope: 'branch', branch_id: 'b1', branch_name: 'ביתר עילית' }), cmd('expense', { branch: 'מודיעין עילית' }), false],
    ['branch · בלי סניף בפקודה',    num({ scope: 'branch', branch_id: 'b1', branch_name: 'ביתר עילית' }), cmd('expense'),                             true],
    ['★ branch · ללא שיוך כלל',     num({ scope: 'branch', branch_id: null }),     cmd('expense'),                       false],
    ['★ מספר מושבת',               num({ is_active: false }),                     cmd('query'),                         false],
  ];

  for (const [label, caller, command, expected] of M) {
    const v = authorizeCommand(caller, command);
    check(`${label} → ${expected ? 'מותר' : 'נחסם'}`, v.allowed === expected,
          `התקבל allowed=${v.allowed}${v.reason ? ` (${v.reason})` : ''}`);
    if (!expected) {
      check(`${label} → הודעה בעברית`, /[א-ת]/.test(v.message ?? ''));
    }
  }

  for (const t of ['תרשמי הוצאה 500', 'תעדכני את שירה', 'תמחקי הכל', 'הוצאה של 300'])
    check(`"${t}" מזוהה כניסיון פקודה`, looksLikeCommand(t) === true);
  for (const t of ['שלום, כמה עולה החוג?', 'באיזה ימים החוג?', 'תודה רבה!'])
    check(`"${t}" אינו ניסיון פקודה`, looksLikeCommand(t) === false);
}

// ═════════════ 6. זרימת האישור ═════════════
console.log('\nזרימת האישור:');
{
  const pendingRow = { id: 'cmd-1', intent: 'expense', raw_text: 'שילמתי 860',
                       parsed: { human_summary: 'הוצאה של 860' } };

  for (const yes of ['כן', 'אישור', '✅', '1']) {
    const { decision, rpcCalls } = await route(owner, yes, {
      commands: { single: pendingRow }, __rpc: { rpc_execute_command: { ok: true, result_table: 'ledger_entries' } },
    });
    check(`"${yes}" מפעיל ביצוע`, decision.route === 'confirmed');
    check(`"${yes}" קורא ל-rpc_execute_command`,
          rpcCalls.some((c) => c.name === 'rpc_execute_command' && c.args.p_command_id === 'cmd-1'));
  }

  for (const no of ['לא', 'ביטול']) {
    const { decision, writes } = await route(owner, no, { commands: { single: pendingRow } });
    check(`"${no}" מבטל את הממתינה`, decision.route === 'declined');
    check(`"${no}" מסמן cancelled`,
          writes.some((w) => w.table === 'commands' && w.payload?.status === 'cancelled'));
    check(`"${no}" משיב בעברית`, decision.reply === 'בוטל, לא נשמר כלום.');
  }

  // ★ ביצוע שנדחה במרוץ — התשובה לא מבטיחה שנרשם
  {
    const { decision } = await route(owner, 'כן', {
      commands: { single: pendingRow },
      __rpc: { rpc_execute_command: { ok: false, reason: 'already_handled' } },
    });
    check('★ אישור שהפסיד במרוץ אינו מדווח על הצלחה',
          !decision.reply.includes('נרשם'), `התקבל: ${decision.reply}`);
    check('★ ומודיע שהפעולה כבר בוצעה', decision.reply.includes('כבר בוצעה'));
  }
  {
    const { decision } = await route(owner, 'כן', {
      commands: { single: pendingRow },
      __rpc: { rpc_execute_command: { ok: false, reason: 'expired' } },
    });
    check('★ פקודה שפגה מדווחת ככזו', decision.reply.includes('פגה'));
  }

  // "בטל" בלי ממתינה → ביטול הפעולה האחרונה
  {
    const { decision, rpcCalls } = await route(owner, 'בטל', {
      commands: { single: null }, __rpc: { rpc_cancel_last_command: { ok: true } },
    });
    check('"בטל" ללא ממתינה מבטל את האחרונה', decision.route === 'undo');
    check('קורא ל-rpc_cancel_last_command',
          rpcCalls.some((c) => c.name === 'rpc_cancel_last_command'));
  }
  {
    const { decision } = await route(owner, 'בטל', {
      commands: { single: null },
      __rpc: { rpc_cancel_last_command: { ok: false, reason: 'nothing_to_cancel', message: 'אין פעולה אחרונה לביטול.' } },
    });
    check('אין מה לבטל — הודעה ברורה', decision.reply === 'אין פעולה אחרונה לביטול.');
  }

  // שדה חסר → שאלה, בלי פקודה ממתינה
  {
    const { decision, writes } = await route(owner, 'תרשמי הוצאה');
    check('★ שדה חסר → שאלה ולא פקודה ממתינה', decision.needsConfirmation === false);
    check('★ שדה חסר → אפס כתיבות', writes.length === 0,
          `נרשמו: ${JSON.stringify(writes)}`);
    check('השאלה נוקבת בשדה החסר', decision.reply?.includes('amount'));
  }

  // כרטיס אישור
  {
    const { decision } = await route(owner, 'שילמתי 860 תלבושות בביתר', { __rpc: { rpc_create_pending_command: 'cmd-9' } });
    check('כרטיס האישור כולל סכום', decision.reply.includes('₪860'));
    check('כרטיס האישור כולל סניף', decision.reply.includes('ביתר עילית'));
    check('כרטיס האישור מסביר איך לאשר', decision.reply.includes('לאישור השיבי: כן'));
    check('נשמר מזהה הפקודה הממתינה', decision.commandId === 'cmd-9');
  }

  // פעולה שנחסמה בהרשאות — אין פקודה ממתינה
  {
    const { decision, writes } = await route(financeUser, 'תמחקי את שירה כהן');
    check('★ פעולה שנחסמה אינה נשמרת כממתינה',
          !writes.some((w) => w.table === 'rpc:rpc_create_pending_command'));
  }
}

console.log(fails === 0
  ? `\nכל בדיקות הנתב עברו (בלי מפתח Anthropic)`
  : `\n${fails} בדיקות נכשלו`);
process.exit(fails ? 1 : 0);
