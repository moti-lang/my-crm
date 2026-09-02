#!/usr/bin/env node
/**
 * ai-command אינה יכולה לכתוב למסד — מבנית, לא מוסכמת.
 *
 * הדרישה: פרסור שנכשל, ביטחון נמוך או JSON פגום — אפס כתיבות,
 * כולל לוגים חלקיים. הדרך החזקה לקיים אותה היא שלפונקציה אין
 * בכלל לקוח מסד, כך שאין מה לקרוא לו בטעות בסבב עתידי.
 *
 * הרצה:  npm run test:purity
 */
import { readFileSync } from 'node:fs';

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

let fails = 0;
const check = (label, ok, detail = '') => {
  if (!ok) fails++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
};

const cmd = stripComments(readFileSync('supabase/functions/ai-command/index.ts', 'utf8'));

check('★ ai-command אינה מייבאת לקוח מסד',   !/from\s+['"]\.\.\/_shared\/supabase\.ts['"]/.test(cmd));
check('★ ai-command אינה קוראת ל-adminClient', !/adminClient/.test(cmd));
check('★ ai-command אינה יוצרת לקוח supabase', !/createClient/.test(cmd));
check('★ ai-command אינה נוגעת בטבלאות',       !/\.from\(/.test(cmd));
check('★ ai-command אינה כותבת ל-audit_log',   !/audit_log/.test(cmd));
check('★ ai-command אינה כותבת ל-commands',    !/\bcommands\b/.test(cmd));
check('ai-command משתמשת בספק המוחלף',         /aiProvider/.test(cmd));

// הספק עצמו — שני המימושים — גם הוא חייב להיות נקי ממסד.
const ai = stripComments(readFileSync('supabase/functions/_shared/ai.ts', 'utf8'));
check('★ שכבת הספק אינה מייבאת לקוח מסד',    !/supabase\.ts|adminClient|createClient/.test(ai));
check('★ שכבת הספק אינה נוגעת בטבלאות',       !/\.from\(['"]/.test(ai));
check('הספק תומך בהרצה יבשה כברירת מחדל',     /AI_DRY_RUN/.test(ai));
check('יש שני מימושים לספק',
      /class DryRunAiProvider/.test(ai) && /class ClaudeAiProvider/.test(ai));
check('★ ה-SDK נטען דינמית — מסלול יבש לא טוען אותו',
      /await import\(['"]npm:@anthropic-ai\/sdk/.test(ai));

// ולידציה — גם היא טהורה
const schema = stripComments(readFileSync('supabase/functions/_shared/command-schema.ts', 'utf8'));
check('★ שכבת הוולידציה אינה נוגעת במסד', !/supabase|\.from\(|adminClient/.test(schema));
check('אין output_config — הסכימה נדחתה על ידי ה-API (ראה ai-wire.test.mjs)', !/output_config:/.test(ai));

// בדיקות ההרשאה — פונקציה טהורה
const auth = stripComments(readFileSync('supabase/functions/_shared/authorize.ts', 'utf8'));
check('★ בדיקות ההרשאה טהורות מרשת וממסד',
      !/supabase|fetch\(|\.from\(|adminClient/.test(auth));

console.log(fails === 0
  ? '\nai-command נקייה ממסד — מבנית'
  : `\n${fails} בדיקות נכשלו — ai-command עלולה לכתוב למסד`);
process.exit(fails ? 1 : 0);
