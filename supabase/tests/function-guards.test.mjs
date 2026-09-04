#!/usr/bin/env node
/**
 * ★ אין Edge Function בלי שומר. מבני, על כל תיקייה תחת functions/.
 *
 * verify_jwt של הפלטפורמה מקבל גם את מפתח ה-anon הציבורי, ו-false
 * פירושו פונקציה פתוחה לעולם. כל פונקציה חייבת אחד משלושה:
 *   requireCronSecret — פנימיות (cron-*, wa-send)
 *   requireUserJwt    — נקראות מהדפדפן (ai-*)
 *   verifyHubSignature — wa-webhook בלבד
 * והשומר חייב להופיע לפני כל גישה למסד. פונקציה חדשה בלי שומר מפילה את זה,
 * ו-functions-deploy-api.mjs מסרב לפרוס אותה.
 * הרצה:  npm run test:guards
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { codeOf } from './_code.mjs';

const ROOT = 'supabase/functions';
let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`); };

export const EXPECTED = {
  'wa-webhook': 'verifyHubSignature',
  'ai-answer': 'requireUserJwt', 'ai-command': 'requireUserJwt',
};
const dirs = readdirSync(ROOT).filter((d) => !d.startsWith('_') && statSync(join(ROOT, d)).isDirectory() && readdirSync(join(ROOT, d)).includes('index.ts'));
check(`יש ${dirs.length} פונקציות`, dirs.length >= 12);
for (const d of dirs) {
  const src = codeOf(join(ROOT, d, 'index.ts'));
  const want = EXPECTED[d] ?? 'requireCronSecret';
  const guardIdx = src.indexOf(`${want}(`);
  check(`★ ${d}: ${want}`, guardIdx !== -1, 'אין שומר');
  // השומר הוא המשפט הראשון בגוף ה-handler — לפני כל דבר אחר.
  const handler = src.slice(src.indexOf('Deno.serve('));
  const body = handler.slice(handler.indexOf('{') + 1).trimStart();
  const first = want === 'verifyHubSignature'
    ? /^if \(req\.method[\s\S]{0,400}verifyHubSignature\(/.test(body)
    : new RegExp(`^const denied = ${want}\\(req\\);\\s*if \\(denied\\) return denied;`).test(body)
      || new RegExp(`^if \\(req\\.method[^\\n]*\\n\\s*const denied = ${want}\\(req\\);\\s*if \\(denied\\) return denied;`).test(body);
  check(`   ${d}: השומר הוא המשפט הראשון ב-handler`, first, body.slice(0, 120).replace(/\n/g, ' '));
}
// הקורא הפנימי של wa-send שולח את אותו סוד
const rem = codeOf(join(ROOT, 'cron-reminders/index.ts'));
check('★ cron-reminders קורא ל-wa-send עם CRON_SECRET', /requireEnv\('CRON_SECRET'\)/.test(rem) && !/SUPABASE_SERVICE_ROLE_KEY/.test(rem));
const guard = codeOf(join(ROOT, '_shared/guard.ts'));
check('★ requireUserJwt דורש role=authenticated (מפתח anon נדחה)', /payload\.role !== 'authenticated'/.test(guard));
check('requireCronSecret משווה ל-CRON_SECRET', /Bearer \$\{requireEnv\('CRON_SECRET'\)\}/.test(guard));
const deploy = codeOf('scripts/functions-deploy-api.mjs');
check('★ הפריסה מסרבת לפונקציה בלי שומר', /slugs\.filter\(\(s\) => !guardOf\(s\)\)/.test(deploy) && /if \(unguarded\.length\) \{[\s\S]*?process\.exit\(1\)/.test(deploy));
console.log(fails === 0 ? '\nכל הפונקציות מוגנות' : `\n${fails} בדיקות נכשלו`);
process.exit(fails ? 1 : 0);
