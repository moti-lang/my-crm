#!/usr/bin/env node
/**
 * בדיקה מבנית: ערוץ ההתראות אינו תלוי בוואטסאפ.
 *
 * ההתראה הכי חשובה במערכת היא "החיבור לוואטסאפ נפל". אם היא עוברת
 * בוואטסאפ, היא נופלת בדיוק ברגע שהיא נחוצה. הבדיקה הזו נכשלת אם
 * מישהו יחבר את השניים בעתיד — כולל אני, בסבב עתידי.
 *
 * הרצה:  npm run test:alerts
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { codeOf } from './_code.mjs';

const FUNCTIONS = 'supabase/functions';
let fails = 0;
const check = (label, ok, detail = '') => {
  if (!ok) fails++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
};

// ─── alerts.ts אינו נוגע בוואטסאפ ───
const alerts = codeOf(join(FUNCTIONS, '_shared/alerts.ts'));
check('★ alerts.ts אינו מייבא את wa.ts', !/from\s+['"]\.\/wa\.ts['"]/.test(alerts));
check('★ alerts.ts אינו קורא ל-wa-send', !/wa-send/.test(alerts));
check('★ alerts.ts אינו משתמש ב-whatsappProvider', !/whatsappProvider|sendText/.test(alerts));
check('alerts.ts כותב ל-audit_log', /audit_log/.test(alerts));
check('alerts.ts כותב ל-system_alerts', /system_alerts/.test(alerts));
check('alerts.ts תומך ב-OWNER_ALERT_WEBHOOK', /OWNER_ALERT_WEBHOOK/.test(alerts));

// ─── שום קורא של alertOwner לא מנסה לשלוח בוואטסאפ באותה זרימה ───
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

for (const file of walk(FUNCTIONS)) {
  const src = codeOf(file);
  if (!/alertOwner/.test(src)) continue;
  const usesWa = /whatsappProvider\(\)\s*\.\s*sendText|fetch\([^)]*wa-send/.test(src);
  check(
    `${file.replace(FUNCTIONS + '/', '')} מתריע בלי לשלוח בוואטסאפ`,
    !usesWa,
    'קובץ שקורא ל-alertOwner ובאותה זרימה שולח הודעת וואטסאפ',
  );
}

// ─── cron-wa-health אינו נשען על הוואטסאפ להתריע ───
const health = codeOf(join(FUNCTIONS, 'cron-wa-health/index.ts'));
check('★ cron-wa-health מתריע רק דרך alertOwner', !/sendText|wa-send/.test(health));
check('cron-wa-health קורא checkHealth בלבד מהספק', /checkHealth/.test(health));

console.log(fails === 0
  ? '\nערוץ ההתראות עצמאי מהוואטסאפ'
  : `\n${fails} בדיקות נכשלו — ההתראה עלולה ליפול יחד עם הוואטסאפ`);
process.exit(fails ? 1 : 0);
