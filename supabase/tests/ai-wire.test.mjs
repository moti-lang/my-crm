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
import { codeOf, rawOf } from './_code.mjs';
import { loadFromSource } from './_from-source.mjs';

const supportsTemperature = loadFromSource('ai.ts', 'supportsTemperature');

let failed = 0;
const ok  = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); failed++; };

const ai    = codeOf('supabase/functions/_shared/ai.ts');
const bench = codeOf('supabase/tests/model-benchmark.mjs');

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
const cs = codeOf('supabase/functions/_shared/command-schema.ts');
if (/JSON\.parse\(extractJson\(raw\)\)/.test(cs))
  ok('validateCommand מחלץ לפני JSON.parse');
else bad('★ validateCommand לא מחלץ — גדר markdown תפיל פקודה תקינה');

if (/extractJson\(raw\)/.test(bench))
  ok('model-benchmark משתמש באותו חילוץ');
else bad('★ model-benchmark לא משתמש באותו חילוץ — מודד משהו אחר מהייצור');

// ─── תקרת הזמן ───
// סוכן שנתקע בשקט הוא הכשל הגרוע ביותר: הניה לא יודעת אם ההוצאה נרשמה.
// הבדיקה מחפשת מבנים בקוד ולא מילים: "AbortController" מופיע גם בהערה
// שמעליו, ובקרת השלילה חשפה שהיא עברה בזכות ההערה בלבד.
const timeoutParts = {
  'setTimeout עם AI_TIMEOUT_MS': /setTimeout\([\s\S]{0,200}?AI_TIMEOUT_MS\)/,
  'new AbortController()':       /new AbortController\(\)/,
  'abort.abort() בפקיעה':        /abort\.abort\(\)/,
  'signal מועבר לבקשה':          /signal:\s*abort\.signal/,
  'Promise.race':                /Promise\.race\(/,
};
const missing = Object.entries(timeoutParts).filter(([, re]) => !re.test(ai)).map(([n]) => n);
if (missing.length === 0) ok('ai.ts: תקרת זמן קשיחה עם ביטול בפועל');
else bad(`★ ai.ts: תקרת הזמן חסרה — ${missing.join(', ')}`);

if (/if \(timedOut\) return timeoutOutcome\(\)/.test(ai))
  ok('ai.ts: ביטול שנזרק עדיין מסווג כ-timeout');
else bad('★ ai.ts: ביטול שנזרק ידווח כ-provider_error ולא יפעיל את התשובה');

const router = codeOf('supabase/functions/_shared/router.ts');
if (/route: 'command_timeout'/.test(router) && /רגע, בודקת/.test(router))
  ok('router.ts: תלייה מחזירה תשובה לשולחת');
else bad('★ router.ts: תלייה לא מייצרת תשובה');

// שליחת התשובה בפועל נבדקת ב-reply-delivery.test.mjs, שמריץ את המסירה
// האמיתית מול ספק מזויף. אין כאן כפילות.

// ─── שכבה 2: קריאה אמיתית ───
// זו הבדיקה היחידה שתופסת שינוי בצד ה-API. פיקסצ'רים מוקלטים לא יתפסו
// אותו לעולם — הם מוקלטים אצלנו. לכן היא רצה בכל ריצת CI, ולא רק ידנית.
//
// שלוש קריאות ולא אחת: הסף הוא על החציון. קריאה בודדת איטית היא רעש
// רשת ולא רגרסיה, וסף שנופל על רעש הופך את ה-CI לרועש ומתעלמים ממנו.
const MAX_MS = Number(process.env.AI_CONTRACT_MAX_MS ?? '3000');
const SAMPLES = Number(process.env.AI_CONTRACT_SAMPLES ?? '3');

if (!process.env.ANTHROPIC_API_KEY) {
  console.log('  ! אין ANTHROPIC_API_KEY — הקריאה האמיתית דולגה');
  if (process.env.CI) bad('★ ב-CI הקריאה האמיתית חובה. חסר ANTHROPIC_API_KEY.');
} else {
  const SYSTEM = rawOf('supabase/functions/_shared/ai.ts').match(/export const COMMAND_SYSTEM_PROMPT = `([\s\S]*?)`;/)[1];
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const extract = loadFromSource('command-schema.ts', 'extractJson');

  const model = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5';
  const user = [
    'הודעה: תרשמי 450 הגברה ביתר',
    `התאריך היום: ${new Date().toISOString().slice(0, 10)}`,
    'סניפים: ביתר עילית · מודיעין עילית',
    'תלמידות פעילות: שירה כהן (ביתר עילית)',
    'קטגוריות: הגברה ותאורה · שכירות אולם',
  ].join('\n');

  const INTENTS = ['expense','income','payment','new_student','update_student',
                   'reminder','attendance','query','unknown'];
  const client = new Anthropic({ timeout: 60000, maxRetries: 0 });
  const times = [];

  for (let i = 1; i <= SAMPLES; i++) {
    const t0 = Date.now();
    let res;
    try {
      res = await client.messages.create({
        model, max_tokens: 800, system: SYSTEM,
        messages: [{ role: 'user', content: user }],
        ...(supportsTemperature(model) ? { temperature: 0 } : {}),
      });
    } catch (e) {
      bad(`★ קריאה ${i} נכשלה: ${String(e.message).slice(0, 200)}`);
      continue;
    }
    const ms = Date.now() - t0;
    times.push(ms);

    const rawText = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (rawText.trim()[0] !== '{') console.log('  ! המודל עטף את ה-JSON — החילוץ נדרש');

    let parsed;
    try { parsed = JSON.parse(extract(rawText)); }
    catch { bad(`★ קריאה ${i}: לא JSON תקין — ${rawText.slice(0, 160)}`); continue; }

    // ★ החוזה. אם ה-API או המודל ישתנו, זה מה שייפול.
    const problems = [];
    if (!INTENTS.includes(parsed.intent)) problems.push(`intent=${JSON.stringify(parsed.intent)}`);
    if (typeof parsed.confidence !== 'number' || parsed.confidence < 0 || parsed.confidence > 1)
      problems.push(`confidence=${JSON.stringify(parsed.confidence)}`);
    if (!parsed.fields || typeof parsed.fields !== 'object') problems.push('fields אינו אובייקט');
    if (!Array.isArray(parsed.missing)) problems.push('missing אינו מערך');
    if (typeof parsed.human_summary !== 'string') problems.push('human_summary אינו מחרוזת');

    if (problems.length) bad(`★ קריאה ${i}: החוזה נשבר — ${problems.join('; ')}`);
    else ok(`קריאה ${i}: החוזה מתקבל (${parsed.intent}, ${ms}ms)`);
  }

  if (times.length === 0) {
    bad('★ אף קריאה לא הצליחה — אין מדידת זמן');
  } else {
    const sorted = [...times].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const label = `חציון ${median}ms מתוך ${times.map((t) => `${t}ms`).join(' · ')}`;
    if (median < MAX_MS) ok(`★ זמן תגובה: ${label} (סף ${MAX_MS}ms)`);
    else bad(`★ זמן תגובה חרג: ${label} (סף ${MAX_MS}ms)`);
  }
}

console.log(failed === 0 ? '\nהבקשה ל-API תקינה' : `\n${failed} בדיקות נכשלו`);
process.exit(failed === 0 ? 0 : 1);
