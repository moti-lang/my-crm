#!/usr/bin/env node
/**
 * מה שנשלח בפועל ל-API.
 *
 * למה הבדיקה הזאת קיימת: המסלול האמיתי אל המודל לא נבדק מעולם. חבילת
 * הבדיקות רצה מול פיקסצ'רים מוקלטים, ולכן הבקשה עצמה מעולם לא יצאה.
 * כשהיא סוף סוף יצאה, כל 60 הקריאות נכשלו — הסכימה שנשלחה כ-output_config
 * נדחתה שלוש פעמים ברצף:
 *
 *   1. For 'number' type, properties maximum, minimum are not supported
 *   2. For 'object' type, 'additionalProperties: true' is not supported
 *   3. Schema is too complex.   (אחרי שכל 21 השדות מנויים במפורש)
 *
 * ובגדלים שכן התקבלו, המחיר היה זמן: 5 שדות ≈ 7.6 שניות, 10 ≈ 15.7,
 * 21 → timeout, מול ~2 שניות בלי output_config. לפקודת וואטסאפ בזמן אמת
 * זה פוסל את המסלול. לכן הייצור עובד עם prefill ואימות משלנו.
 *
 * שתי שכבות:
 *   1. סטטית — הייצור וההשוואה בונים את אותה בקשה. חינם, רצה תמיד.
 *   2. חיה — קריאה אמיתית אחת שעוברת את אותו validateShape של הייצור.
 *      רצה רק עם ANTHROPIC_API_KEY.
 */
import { readFileSync } from 'node:fs';

let failed = 0;
const ok  = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); failed++; };

const ai    = readFileSync('supabase/functions/_shared/ai.ts', 'utf8');
const bench = readFileSync('supabase/tests/model-benchmark.mjs', 'utf8');

// ─── שכבה 1: הייצור וההשוואה מדברים אותה שפה ───
for (const [name, src] of [['ai.ts', ai], ['model-benchmark.mjs', bench]]) {
  if (/output_config\s*:/.test(src)) {
    bad(`★ ${name} שולח output_config — ה-API דוחה את הסכימה שלנו`);
  } else {
    ok(`${name}: אין output_config`);
  }
  if (/role:\s*'assistant'/.test(src)) {
    bad(`★ ${name} שולח prefill — המודל אינו תומך בזה ומחזיר 400`);
  } else {
    ok(`${name}: אין prefill`);
  }
}

// בלי אכיפה בצד ה-API, החילוץ הוא ההגנה היחידה מפני עטיפה.
const cs = readFileSync('supabase/functions/_shared/command-schema.ts', 'utf8');
if (/JSON\.parse\(extractJson\(raw\)\)/.test(cs))
  ok('validateCommand מחלץ לפני JSON.parse');
else bad('★ validateCommand לא מחלץ — גדר markdown תפיל פקודה תקינה');

if (/extractJson\(raw\)/.test(bench))
  ok('model-benchmark משתמש באותו חילוץ');
else bad('★ model-benchmark לא משתמש באותו חילוץ — מודד משהו אחר מהייצור');

// ─── שכבה 2: קריאה אמיתית ───
if (!process.env.ANTHROPIC_API_KEY) {
  console.log('  ! אין ANTHROPIC_API_KEY — הקריאה האמיתית דולגה');
} else {
  const SYSTEM = ai.match(/export const COMMAND_SYSTEM_PROMPT = `([\s\S]*?)`;/)[1];
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  // אותה פונקציית חילוץ של הייצור, מהמקור.
  const extract = Function('"use strict"; return (' +
    cs.match(/export function extractJson\(raw: string\): string \{[\s\S]*?\n\}/)[0]
      .replace('export function extractJson(raw: string): string', 'function extractJson(raw)')
    + ')')();
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
  const user = [
    'הודעה: תרשמי 450 הגברה ביתר',
    `התאריך היום: ${new Date().toISOString().slice(0, 10)}`,
    'סניפים: ביתר עילית · מודיעין עילית',
    'תלמידות פעילות: שירה כהן (ביתר עילית)',
    'קטגוריות: הגברה ותאורה · שכירות אולם',
  ].join('\n');

  const t0 = Date.now();
  try {
    const res = await new Anthropic({ timeout: 60000, maxRetries: 1 }).messages.create({
      model, max_tokens: 800, system: SYSTEM,
      messages: [{ role: 'user', content: user }],
      ...(model.includes('4-6') ? { temperature: 0 } : {}),
    });
    const ms = Date.now() - t0;
    const rawText = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const wrapped = rawText.trim()[0] !== '{';
    if (wrapped) console.log(`  ! המודל עטף את ה-JSON — החילוץ נדרש`);
    const raw = extract(rawText);

    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { bad(`★ המודל לא החזיר JSON תקין: ${raw.slice(0, 160)}`); parsed = null; }

    if (parsed) {
      ok(`★ קריאה אמיתית החזירה JSON תקין (${model}, ${ms}ms)`);
      // אותם כללים בדיוק שב-validateShape בייצור.
      const INTENTS = ['expense','income','payment','new_student','update_student',
                       'reminder','attendance','query','unknown'];
      if (INTENTS.includes(parsed.intent)) ok(`intent חוקי: ${parsed.intent}`);
      else bad(`★ intent לא חוקי: ${JSON.stringify(parsed.intent)}`);

      if (typeof parsed.confidence === 'number' && parsed.confidence >= 0 && parsed.confidence <= 1)
        ok(`confidence בטווח: ${parsed.confidence}`);
      else bad(`★ confidence מחוץ לטווח: ${JSON.stringify(parsed.confidence)}`);

      if (parsed.fields && typeof parsed.fields === 'object') ok('fields הוא אובייקט');
      else bad('★ fields אינו אובייקט');

      if (ms > 8000) bad(`★ ${ms}ms לפקודה — איטי מדי לוואטסאפ בזמן אמת`);
      else ok(`זמן תגובה סביר: ${ms}ms`);
    }
  } catch (e) {
    bad(`★ הקריאה נכשלה: ${String(e.message).slice(0, 200)}`);
  }
}

console.log(failed === 0 ? '\nהבקשה ל-API תקינה' : `\n${failed} בדיקות נכשלו`);
process.exit(failed === 0 ? 0 : 1);
