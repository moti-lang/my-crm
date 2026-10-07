// "הבוט כבוי": הודעה נכנסת נבדקת מול wa_bot_paused לפני כל עיבוד — לא נשמרת,
// לא נענית, לא מפעילה פקודה. והמתג במסך — רק לבעלים.
import { fileURLToPath } from 'node:url';
import { codeOf } from './_code.mjs';
const src = (f) => codeOf(fileURLToPath(new URL(`../../${f}`, import.meta.url)));
const hook = src('supabase/functions/wa-webhook/index.ts');
const ui = src('src/components/WaConnect.tsx'), settings = src('src/pages/Settings.tsx');
let failed = 0;
const check = (name, ok) => { console.log(`  ${ok ? '✓' : '✗'} ${name}`); if (!ok) failed++; };
const recv = hook.slice(hook.indexOf("case 'message.received'"), hook.indexOf("case 'connection.changed'"));
const pauseAt = recv.indexOf("if (paused?.value === true) return json(");
check('★ הודעה נכנסת: בדיקת wa_bot_paused לפני handleIncoming', /eq\('key', 'wa_bot_paused'\)/.test(recv) && pauseAt > 0 && pauseAt < recv.indexOf('handleIncoming('));
check('אירועי חיבור ותוצאות שליחה לא מושפעים מהמתג', !/wa_bot_paused/.test(hook.slice(hook.indexOf("case 'connection.changed'"))));
check('★ המתג במסך: בתוך WaConnect, שמוצג רק לבעלים', /<BotSwitch \/>/.test(ui) && /profile\?\.role === 'owner' && <div[^>]*><WaConnect \/>/.test(settings));
if (failed) { console.log(`  ✗ ${failed} בדיקות מתג הבוט נכשלו`); process.exit(1); }
console.log('  כל בדיקות מתג הבוט עברו');
