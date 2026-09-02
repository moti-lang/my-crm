#!/usr/bin/env node
/**
 * השוואת מודלים על פקודות עבריות אמיתיות.
 *
 * מודד שלושה דברים לכל מודל: intent נכון, סכום נכון, סניף נכון.
 * ההכרעה איזה מודל להריץ בייצור היא מדידה, לא הערכה.
 *
 *   npm run bench:model                              # שני מודלי ברירת המחדל
 *   npm run bench:model -- claude-opus-5 claude-sonnet-4-6
 *
 * דורש ANTHROPIC_API_KEY. הקריאות עולות כסף — 30 פקודות לכל מודל.
 */
import { readFileSync } from 'node:fs';
import { loadFromSource } from './_from-source.mjs';

// שתי הפונקציות של הייצור, נטענות מהמקור כדי שלא יהיו עותקים שניים.
const extractJson = loadFromSource('command-schema.ts', 'extractJson');
const supportsTemperature = loadFromSource('ai.ts', 'supportsTemperature');

const DEFAULT_MODELS = ['claude-haiku-4-5', 'claude-sonnet-4-6'];
const models = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const MODELS = models.length > 0 ? models : DEFAULT_MODELS;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(`
✗ חסר ANTHROPIC_API_KEY.

  ההשוואה מריצה ${30 * MODELS.length} קריאות אמיתיות ל-API ועולה כסף.
  היא לא רצה כחלק מ-npm test בכוונה.

    ANTHROPIC_API_KEY=sk-ant-... npm run bench:model
`);
  process.exit(2);
}

// טעינה אחרי בדיקת המפתח, כדי שההודעה תהיה ברורה ולא ERR_MODULE_NOT_FOUND
const { default: Anthropic } = await import('@anthropic-ai/sdk');

const { cases } = JSON.parse(readFileSync('supabase/tests/fixtures/command-benchmark.json', 'utf8'));

// אותו הקשר שהנתב מספק בייצור.
const BRANCHES = ['ביתר עילית', 'מודיעין עילית', 'ירושלים רמות', 'בית שמש', 'אשדוד'];
const STUDENTS = [
  ['שירה כהן', 'ביתר עילית'], ['מלכי ברגר', 'ביתר עילית'], ['אסתי וייס', 'ביתר עילית'],
  ['חני שטרן', 'ביתר עילית'], ['ריקי לוינגר', 'ביתר עילית'], ['שרי פרידמן', 'מודיעין עילית'],
  ['אדל רוזנפלד', 'ירושלים רמות'], ['יוכי מנדלסון', 'בית שמש'], ['תמר ביטון', 'אשדוד'],
];
const CATEGORIES = ['שכירות אולם', 'שכר מדריכה', 'הגברה ותאורה', 'תלבושות', 'תפאורה',
                    'ציוד מתכלה', 'פרסום מקומי', 'כיבוד', 'חסויות', 'כרטיסים להצגה'];

const SYSTEM = readFileSync('supabase/functions/_shared/ai.ts', 'utf8')
  .match(/export const COMMAND_SYSTEM_PROMPT = `([\s\S]*?)`;/)[1];

// אין SCHEMA. ההשוואה חייבת למדוד בדיוק את מה שרץ בייצור, ובייצור
// אין output_config — ראה את ההערה ב-ai.ts.

const client = new Anthropic();

const userMessage = (text) => [
  `הודעה: ${text}`,
  `התאריך היום: ${new Date().toISOString().slice(0, 10)}`,
  `סניפים: ${BRANCHES.join(' · ')}`,
  `תלמידות פעילות: ${STUDENTS.map(([n, b]) => `${n} (${b})`).join(' · ')}`,
  `קטגוריות: ${CATEGORIES.join(' · ')}`,
].join('\n');

async function run(model, text) {
  const params = {
    model, max_tokens: 800, system: SYSTEM,
    messages: [{ role: 'user', content: userMessage(text) }],
  };
  // אותה פונקציה של הייצור, מהמקור. תנאי מועתק היה נותן להשוואה למדוד
  // הגדרות אחרות מאלה שרצות בפועל.
  if (supportsTemperature(model)) params.temperature = 0;

  try {
    const res = await client.messages.create(params);
    if (res.stop_reason === 'refusal') return { error: 'refusal' };
    const raw = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    // אותו חילוץ שבייצור.
    return { parsed: JSON.parse(extractJson(raw)), usage: res.usage, raw };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const results = {};

for (const model of MODELS) {
  console.log(`\n═══ ${model} ═══`);
  const score = { intent: 0, amount: 0, branch: 0, amountN: 0, branchN: 0, errors: 0, inTok: 0, outTok: 0 };
  const misses = [];

  for (const c of cases) {
    const r = await run(model, c.text);
    if (r.error) { score.errors++; misses.push([c.text, `שגיאה: ${r.error}`]); continue; }

    score.inTok += r.usage?.input_tokens ?? 0;
    score.outTok += r.usage?.output_tokens ?? 0;

    const got = r.parsed;
    const intentOk = got.intent === c.intent;
    if (intentOk) score.intent++;

    let amountOk = null;
    if (c.amount !== null) {
      score.amountN++;
      amountOk = num(got.fields?.amount) === c.amount;
      if (amountOk) score.amount++;
    }

    let branchOk = null;
    if (c.branch !== null) {
      score.branchN++;
      branchOk = (got.fields?.branch ?? null) === c.branch;
      if (branchOk) score.branch++;
    }

    const bad = [];
    if (!intentOk) bad.push(`intent=${got.intent} (${c.intent})`);
    if (amountOk === false) bad.push(`amount=${JSON.stringify(got.fields?.amount)} (${c.amount})`);
    if (branchOk === false) bad.push(`branch=${JSON.stringify(got.fields?.branch)} (${c.branch})`);
    if (bad.length) misses.push([c.text, bad.join(' · ')]);

    process.stdout.write(bad.length ? '✗' : '·');
  }

  console.log('');
  const pct = (a, b) => (b === 0 ? '—' : `${Math.round((a / b) * 100)}%`);
  console.log(`  intent:  ${score.intent}/${cases.length}  (${pct(score.intent, cases.length)})`);
  console.log(`  סכום:    ${score.amount}/${score.amountN}  (${pct(score.amount, score.amountN)})`);
  console.log(`  סניף:    ${score.branch}/${score.branchN}  (${pct(score.branch, score.branchN)})`);
  if (score.errors) console.log(`  שגיאות:  ${score.errors}`);
  console.log(`  טוקנים:  ${score.inTok} קלט · ${score.outTok} פלט`);

  if (misses.length) {
    console.log('\n  טעויות:');
    for (const [text, why] of misses) console.log(`    "${text}"\n      ${why}`);
  }
  results[model] = score;
}

// ─────────────── הכרעה ───────────────
console.log('\n═══════════════════════════════════');
const total = (s) => s.intent + s.amount + s.branch;
const ranked = MODELS.map((m) => [m, total(results[m])]).sort((a, b) => b[1] - a[1]);
const maxScore = cases.length + results[MODELS[0]].amountN + results[MODELS[0]].branchN;

for (const [m, t] of ranked) console.log(`  ${m}: ${t}/${maxScore}`);

// ★ אין הכרעה על אפסים. שני מודלים שקיבלו 0 אינם "שקולים" — ההשוואה
// פשוט לא רצתה. זה בדיוק הדפוס של בדיקה שמשווה שני אפסים ומדווחת הצלחה.
const totalErrors = MODELS.reduce((a, m) => a + results[m].errors, 0);
if (totalErrors > 0) {
  console.log(`\n  ✗ ${totalErrors} קריאות נכשלו. אין כאן מדידה, יש תקלה.`);
  console.log('    ההודעה הראשונה למעלה. ההשוואה לא הוכרעה.');
  process.exit(1);
}
if (ranked[0][1] === 0) {
  console.log('\n  ✗ כל המודלים קיבלו 0. אין כאן מדידה. ההשוואה לא הוכרעה.');
  process.exit(1);
}

if (ranked.length > 1) {
  const gap = ranked[0][1] - ranked[1][1];
  const gapPct = Math.round((gap / maxScore) * 100);
  console.log(`\n  הפרש: ${gap} נקודות (${gapPct}%)`);
  console.log(gapPct >= 5
    ? `  → הפרש משמעותי. שווה לעבור ל-${ranked[0][0]}: ANTHROPIC_MODEL=${ranked[0][0]}`
    : `  → ההפרש אינו משמעותי. אין סיבה להחליף.`);
}
