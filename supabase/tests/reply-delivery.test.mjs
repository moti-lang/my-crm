#!/usr/bin/env node
/**
 * ★ כל החלטה שנושאת reply באמת מגיעה לשליחה.
 *
 * הממצא שהוליד את הבדיקה: wa-webhook חישב החלטה, רשם לוג, ולא שלח דבר.
 * מנגנון הפקודות היה מת — כרטיס אישור לא יצא, שאלה על שדה חסר לא יצאה,
 * הודעת דחייה לא יצאה. אף בדיקה לא תפסה, כי כולן נעצרו בהחלטה של הנתב
 * ואף אחת לא שאלה מה קורה איתה אחר כך.
 *
 * הראיה כאן אינה קריאת קוד: הנתב רץ באמת, ההחלטה עוברת ב-deliverReply
 * האמיתי, והספק מזויף ומתעד כל שליחה. אם החיבור יינתק — הרשימה תהיה ריקה
 * והבדיקה תיפול.
 *
 * בנוסף נבדקת שלמות: כל מסלול שמוגדר ב-RouteDecision חייב להיות מכוסה כאן.
 * מסלול חדש בלי כיסוי מפיל את הבדיקה.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codeOf, rawOf, hasCall } from './_code.mjs';

process.env.AI_DRY_RUN = 'true';

const dir = mkdtempSync(join(tmpdir(), 'reply-'));
const bundle = (src, name) => {
  const out = join(dir, name);
  execFileSync('npx', ['esbuild', src, '--bundle', '--format=esm', `--outfile=${out}`,
    '--log-level=error', '--define:Deno.env.get=__denoEnvGet',
    '--banner:js=const __denoEnvGet = (k) => process.env[k];'], { stdio: 'inherit' });
  return out;
};

const { routeIncoming } = await import(bundle('supabase/functions/_shared/router.ts', 'router.mjs'));
const { deliverReply } = await import(bundle('supabase/functions/_shared/reply.ts', 'reply.mjs'));

let fails = 0;
const check = (label, ok, detail = '') => {
  if (!ok) fails++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
};

// ─────────── מסד וספק מזויפים ───────────
function makeDb(rows) {
  const writes = [];
  const build = (table) => {
    const chain = {};
    for (const op of ['select', 'eq', 'is', 'gte', 'lte', 'order', 'limit', 'contains']) chain[op] = () => chain;
    chain.maybeSingle = async () => ({ data: rows[table]?.single ?? null, error: null });
    chain.then = (resolve) => resolve({ data: rows[table]?.list ?? [], error: null });
    for (const op of ['insert', 'update', 'upsert', 'delete']) {
      chain[op] = (payload) => { writes.push({ table, op, payload }); return chain; };
    }
    return chain;
  };
  return {
    db: {
      from: build,
      rpc: async (name) => ({ data: rows.__rpc?.[name] ?? null, error: null }),
    },
    writes,
  };
}

/** ספק וואטסאפ מזויף שמתעד כל שליחה. */
function makeWa({ ok = true, error } = {}) {
  const sends = [];
  return {
    sends,
    wa: {
      sendText: async (to, body, idempotencyKey) => {
        sends.push({ to, body, idempotencyKey });
        return ok ? { ok: true, providerMsgId: 'x1' } : { ok: false, error: error ?? 'שרת לא זמין' };
      },
      checkHealth: async () => ({ ok: true }),
    },
  };
}

const owner = {
  phone: '972501234567', label: 'הניה (אישי)', scope: 'all',
  branch_id: null, can_delete: true, is_active: true, branches: null,
};
const financeUser = { ...owner, phone: '972533333333', label: 'שרה', scope: 'finance', can_delete: false };

const base = (caller) => ({
  authorized_numbers: { single: caller },
  branches: { list: [{ name: 'ביתר עילית' }, { name: 'מודיעין עילית' }] },
  v_student_overview: { list: [{ full_name: 'שירה כהן', branch_name: 'ביתר עילית' }] },
  categories: { list: [{ name: 'תלבושות' }, { name: 'שכירות אולם' }] },
});

const deps = { alert: async () => {} };

/** מריץ את הנתב ואז את המסירה האמיתית, בדיוק כמו ב-wa-webhook. */
async function routeAndDeliver(caller, body, extra = {}, waOpts) {
  const { db } = makeDb({ ...base(caller), ...extra });
  const { wa, sends } = makeWa(waOpts);
  const phone = caller?.phone ?? '972500000000';
  const decision = await routeIncoming(db, deps, { phone, body });
  const result = await deliverReply(db, wa, phone, decision, `reply:msg-1`);
  return { decision, sends, result };
}

// ═════════ 1. כל מסלול שנושא reply באמת נשלח ═════════
console.log('\n★ כל reply מגיע לספק:');

const seen = new Set();

const CASES = [
  ['כרטיס אישור להוצאה',  owner,       'שילמתי 860 תלבושות בביתר', {}],
  ['שאלה על שדה חסר',      owner,       'תרשמי הוצאה',              {}],
  ['דחייה על חוסר הרשאה',  financeUser, 'תמחקי את שירה כהן',        {}],
  ['תלייה של המודל',       owner,       '__FIXTURE_TIMEOUT__',      {}],
];

for (const [label, caller, body, extra] of CASES) {
  const { decision, sends } = await routeAndDeliver(caller, body, extra);
  seen.add(decision.route);
  const reply = decision.reply;
  if (typeof reply !== 'string' || reply.trim() === '') {
    // אין reply — אין מה למסור, וזו עדיין תוצאה תקפה שמדווחת.
    check(`${label} — אין reply (מסלול ${decision.route})`, sends.length === 0,
          `נשלח בכל זאת: ${JSON.stringify(sends)}`);
    continue;
  }
  check(`${label} → נשלח לספק`, sends.length === 1,
        `מסלול ${decision.route}, נשלחו ${sends.length}`);
  check(`${label} → אותו טקסט בדיוק`, sends[0]?.body === reply,
        `reply=${JSON.stringify(reply)} נשלח=${JSON.stringify(sends[0]?.body)}`);
  check(`${label} → אל השולחת`, sends[0]?.to === caller.phone);
  check(`${label} → מפתח אידמפוטנטיות נגזר מההודעה`,
        sends[0]?.idempotencyKey === 'reply:msg-1');
}

// ═════════ 2. אישור וביטול — המסלולים שהיו מתים לגמרי ═════════
console.log('\n★ אישור, דחייה וביטול:');
// פקודה ממתינה במסד — בלעדיה "כן" ו"לא" נופלים למסלול הפרסור,
// וזו בדיוק הטעות שבדיקת השלמות למטה תפסה בגרסה הראשונה של הקובץ הזה.
const PENDING = {
  commands: {
    single: {
      id: 'cmd-1', intent: 'expense', raw_text: 'שילמתי 860 תלבושות בביתר',
      parsed: { human_summary: 'הוצאה 860 ₪ תלבושות בביתר עילית' },
    },
  },
};
const CONFIRM = [
  ['אישור', 'כן',  { ...PENDING, __rpc: { rpc_execute_command: { ok: true, result_table: 'ledger_entries' } } }],
  ['דחייה', 'לא',  { ...PENDING }],
  ['ביטול', 'בטל', { __rpc: { rpc_cancel_last_command: { ok: true } } }],
];
for (const [label, body, extra] of CONFIRM) {
  const { decision, sends } = await routeAndDeliver(owner, body, extra);
  seen.add(decision.route);
  if (typeof decision.reply === 'string' && decision.reply.trim() !== '') {
    check(`${label} → נשלח`, sends.length === 1 && sends[0].body === decision.reply,
          `מסלול ${decision.route}, נשלחו ${sends.length}`);
  } else {
    check(`${label} → אין reply, אין שליחה (מסלול ${decision.route})`, sends.length === 0);
  }
}

// ═════════ 3. כישלון שליחה אינו נבלע ═════════
console.log('\n★ כישלון שליחה:');
{
  const { result, sends } = await routeAndDeliver(owner, 'שילמתי 860 תלבושות בביתר', {},
                                                  { ok: false, error: 'הקצה לא זמין' });
  check('נעשה ניסיון שליחה', sends.length === 1);
  check('הכישלון מוחזר ולא נבלע',
        result.delivered === false && result.reason === 'send_failed',
        JSON.stringify(result));
  check('השגיאה נשמרת בתוצאה', result.error === 'הקצה לא זמין');
}

// ═════════ 4. מסלול בלי reply לא שולח כלום ═════════
console.log('\nמסלול בלי reply:');
{
  const { decision, sends, result } = await routeAndDeliver(owner, '__FIXTURE_NOT_JSON__');
  seen.add(decision.route);
  check('כישלון פרסור אינו שולח הודעה', sends.length === 0,
        `נשלח: ${JSON.stringify(sends)}`);
  check('התוצאה מדווחת no_reply', result.reason === 'no_reply');
}
{
  const { decision, sends } = await routeAndDeliver({ ...owner, phone: '972599999999', is_active: false },
                                                    'שלום', { authorized_numbers: { single: null } });
  seen.add(decision.route);
  check('מספר לא מוכר אינו מקבל תשובה מהנתב', sends.length === 0);
}

// ═════════ 5. שלמות: כל מסלול מוגדר נבדק ═════════
console.log('\n★ שלמות הכיסוי:');
const routerSrc = codeOf('supabase/functions/_shared/router.ts');
const declared = [...routerSrc.matchAll(/route:\s*'([a-z_]+)'/g)].map((m) => m[1]);
const declaredSet = [...new Set(declared)];
const uncovered = declaredSet.filter((r) => !seen.has(r));
check(`כל ${declaredSet.length} המסלולים המוגדרים נבדקו`, uncovered.length === 0,
      `לא נבדקו: ${uncovered.join(', ')}`);

// ═════════ 6. ה-webhook באמת קורא למסירה ═════════
// בדיקת מבנה ולא מחרוזת: הקוד נקרא בלי הערות, ומחפשים קריאה לפונקציה.
console.log('\n★ החיבור ב-wa-webhook:');
const hook = codeOf('supabase/functions/wa-webhook/index.ts');
check('wa-webhook קורא ל-deliverReply', hasCall(hook, 'deliverReply'),
      'ההחלטה מחושבת ואיש אינו שולח אותה');
check('deliverReply מיובאת מהמקור המשותף',
      /import\s*\{[^}]*deliverReply[^}]*\}\s*from\s*'\.\.\/_shared\/reply\.ts'/.test(hook));
check('מפתח האידמפוטנטיות נגזר ממזהה ההודעה',
      /reply:\$\{message\.providerMsgId\}/.test(rawOf('supabase/functions/wa-webhook/index.ts')));

console.log(fails === 0 ? '\nכל reply מגיע לשליחה' : `\n${fails} בדיקות נכשלו`);
process.exit(fails === 0 ? 0 : 1);
