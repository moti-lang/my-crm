// "הבוט כבוי": הודעה נכנסת נבדקת מול wa_bot_paused לפני כל עיבוד — לא נשמרת,
// לא נענית, לא מפעילה פקודה. והמתג במסך — רק לבעלים.
import { fileURLToPath } from 'node:url';
import { codeOf } from './_code.mjs';
const src = (f) => codeOf(fileURLToPath(new URL(`../../${f}`, import.meta.url)));
const hook = src('supabase/functions/_shared/wa-webhook-core.ts');
const ui = src('src/components/WaConnect.tsx'), settings = src('src/pages/Settings.tsx');
let failed = 0;
const check = (name, ok) => { console.log(`  ${ok ? '✓' : '✗'} ${name}`); if (!ok) failed++; };
const pauseAt = hook.indexOf("if (paused?.value === true) return json(");
check('★ הודעה נכנסת: בדיקת wa_bot_paused לפני handleIncoming', /eq\('key', 'wa_bot_paused'\)/.test(hook) && pauseAt > 0 && pauseAt < hook.indexOf('return await handleIncoming('));
check('אירועי מכשיר (ניתוק / חסימה) לא מושפעים מהמתג', hook.indexOf("if (event.kind === 'device') return await handleDevice(") < hook.indexOf("eq('key', 'wa_bot_paused')"));
check('★ המתג במסך: בתוך WaConnect, שמוצג רק לבעלים', /<BotSwitch \/>/.test(ui) && /profile\?\.role === 'owner' && <div[^>]*><WaConnect \/>/.test(settings));
// מצב צפייה: טיוטה שלא נשלחה מסומנת ככזו בשיחות — אחרת נראית כמו הודעה שיצאה.
const agent = src('src/pages/Agent.tsx');
check('★ שיחות: הודעה יוצאת עם dry_run מסומנת "טיוטה · לא נשלחה"', /const draft = m\.direction === 'out' && meta\.dry_run === true;/.test(agent) && /\{draft && <p[^>]*>טיוטה · לא נשלחה להורה<\/p>\}/.test(agent));
check('שיחות: מקור התשובה מוצג (מאגר / ברכה / אין תשובה)', /ROUTE_LABEL\[meta\.route\]/.test(agent));
check('הגדרות: הודעת "מצב צפייה" כשהשליחה כבויה, ו"מצב בדיקה" כשיש מספר בדיקה', /if \(mode\.dryRun\) \{/.test(ui) && /if \(mode\.testPhoneTail\) \{/.test(ui)
      && /dryRun: waDryRun\(\)/.test(src('supabase/functions/wa-admin/index.ts')));

if (failed) { console.log(`  ✗ ${failed} בדיקות מתג הבוט נכשלו`); process.exit(1); }
console.log('  כל בדיקות מתג הבוט עברו');
