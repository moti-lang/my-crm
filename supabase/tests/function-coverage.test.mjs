#!/usr/bin/env node
/**
 * ★ כל פונקציה בסכמה חייבת בדיקה שמריצה אותה בפועל.
 *
 * הלקח שהוליד את הקובץ: rpc_issue_attendance_link הייתה מכוסה
 * בבדיקה שמוודאת ש-anon חסום ממנה — ותו לא. באג שהפיל אותה לגמרי
 * בענן שרד 374 בדיקות, כי אף אחת לא הריצה אותה.
 *
 * **בדיקה שרק מוודאת חסימה אינה מוודאת שהדבר עובד.**
 *
 * הבדיקה הזו נכשלת על פונקציה חדשה שאין לה קריאה חיובית באף חבילה.
 *
 * הרצה:  npm run test:coverage
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { codeOf } from './_code.mjs';
import { join } from 'node:path';

const DIR = 'supabase/tests';
const PSQL = ['-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', 'teichtal', '-tAc'];

/** פונקציות הייצור — לא עזרי הבדיקה שנוצרים ונמחקים בתוך ההרצה. */
const functions = execFileSync('psql', [...PSQL, `
  select p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and p.proname not like 'assert\\_%'
    and p.proname not like 't\\_%'
    and p.proname not like 'drop_assert%'
  order by p.proname`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);

// כל קבצי הבדיקה: SQL ו-JS כאחד
const sources = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql') || f.endsWith('.mjs'))
  .filter((f) => f !== 'function-coverage.test.mjs')
  // בלי הערות: פונקציה שמוזכרת בהערה אינה מכוסה בבדיקה.
  .map((f) => codeOf(join(DIR, f)))
  .join('\n');

/** טריגרים אינם נקראים בשם — מריצים אותם דרך INSERT/UPDATE על הטבלה. */
const TRIGGER_FUNCTIONS = {
  f_touch_updated_at:    /updated_at\s*>\s*v_before|מקדם את updated_at/,
  f_guard_photo_consent: /production_cast|אישור צילום/,
};

let fails = 0;
const check = (label, ok, detail = '') => {
  if (!ok) fails++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
};

console.log(`\n${functions.length} פונקציות בסכמה:\n`);

for (const fn of functions) {
  if (fn in TRIGGER_FUNCTIONS) {
    check(`${fn} — טריגר, מורץ דרך הטבלה`, TRIGGER_FUNCTIONS[fn].test(sources),
          'אין בדיקה שמפעילה את הטריגר בפועל');
    continue;
  }

  // קריאה חיובית: השם ואחריו סוגריים, כשהשורה אינה בדיקת חסימה בלבד
  const positive = sources
    .split('\n')
    .filter((line) => new RegExp(`(?<![A-Za-z0-9_])${fn}\\s*\\(`).test(line))
    .filter((line) => !/assert_no_execute|assert_no_privilege|has_function_privilege/.test(line))
    .filter((line) => !/^\s*(--|\*|\/\/)/.test(line));

  check(`${fn} — נקראת בפועל`, positive.length > 0,
        'יש לה אולי בדיקת חסימה, אבל אף בדיקה לא מריצה אותה ומאמתת פלט');
}

console.log(fails === 0
  ? '\nלכל פונקציה יש בדיקה שמריצה אותה'
  : `\n${fails} פונקציות ללא בדיקה חיובית — באג בהן ישרוד את כל החבילה`);
process.exit(fails ? 1 : 0);
