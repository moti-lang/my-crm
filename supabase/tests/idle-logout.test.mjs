#!/usr/bin/env node
/**
 * ★ יציאה אוטומטית: 30 דקות בלי פעילות, אזהרה דקה לפני, מסך האחראית פטור.
 * וניקוי הזיכרון בהחלפת משתמשת (queryClient.clear).
 *   npm run test:idle
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codeOf } from './_code.mjs';

let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`); };
const dir = mkdtempSync(join(tmpdir(), 'idle-'));
const out = join(dir, 'idle.cjs');
execFileSync('npx', ['esbuild', 'src/lib/idle.ts', '--bundle', '--format=cjs', '--platform=node', `--outfile=${out}`, '--log-level=error']);
const idle = await import(out);
const MIN = 60_000;

console.log('\nמכונת המצבים:');
check('★ 30 דקות בדיוק → יציאה', idle.idleState(0, 30 * MIN) === 'expired');
check('29:59 → אזהרה', idle.idleState(0, 30 * MIN - 1000) === 'warning');
check('★ 29:00 → אזהרה (דקה לפני)', idle.idleState(0, 29 * MIN) === 'warning');
check('28:59 → פעיל', idle.idleState(0, 29 * MIN - 1000) === 'active');
check('פעילות עכשיו → פעיל', idle.idleState(1000, 1000) === 'active');
check('ספירה לאחור: ב-29:30 נותרו 30 שניות', idle.secondsLeft(0, 29 * MIN + 30_000) === 30);
check('ספירה לאחור לא שלילית', idle.secondsLeft(0, 40 * MIN) === 0);
check('מחשב שנרדם לשעתיים → יציאה (חותמת זמן, לא טיימר)', idle.idleState(0, 120 * MIN) === 'expired');
check('★ IDLE_LIMIT_MS = 30 דקות', idle.IDLE_LIMIT_MS === 30 * MIN);
check('★ IDLE_WARN_MS = דקה', idle.IDLE_WARN_MS === MIN);

console.log('\nמסך האחראית פטור:');
check('★ /a/<token> פטור', idle.isIdleExempt('/a/abc123'));
check('/students לא פטור', !idle.isIdleExempt('/students'));
check('/agent לא פטור', !idle.isIdleExempt('/agent'));
check('/attendance (המסך הפנימי) לא פטור', !idle.isIdleExempt('/attendance'));

console.log('\nחיבור לאפליקציה:');
const app = codeOf('src/App.tsx');
const guard = codeOf('src/auth/IdleGuard.tsx');
const sheet = codeOf('src/pages/AttendanceSheet.tsx');
const gate = app.slice(app.indexOf('function Gate()'), app.indexOf('export default function App'));
check('★ IdleGuard מורכב בתוך Gate, אחרי בדיקת הפרופיל (רק למחוברות)', /if \(!profile[\s\S]*<IdleGuard \/>/.test(gate));
check('★ IdleGuard משתמש ב-idleState ומתנתק כשפג', /idleState\(/.test(guard) && /=== 'expired'\) void signOut\(\)/.test(guard));
check('IdleGuard מכבד את הפטור', /isIdleExempt\(pathname\)/.test(guard) && /if \(exempt\) return;/.test(guard));
check('★ מסך האחראית מחוץ ל-AuthProvider ובלי IdleGuard', !/IdleGuard|useAuth/.test(sheet) && /<Route path="\/a\/:token" element=\{<AttendanceSheet \/>\} \/>/.test(app));
check('האזהרה בעברית עם כפתור המשך', /עדיין כאן\?/.test(guard) && /אני כאן/.test(guard));
check('באזהרה, רק הכפתור מאפס (לא תזוזת עכבר)', /=== 'active'\) last\.current = Date\.now\(\)/.test(guard));
check('★ החלפת משתמשת (כולל יציאה) מנקה את הזיכרון: queryClient.clear()', /prevUser\.current !== userId\) \{ queryClient\.clear\(\)/.test(gate));

console.log(fails === 0 ? '\nיציאה אוטומטית: הכל במקום' : `\n${fails} בדיקות נכשלו`);
process.exit(fails ? 1 : 0);
