#!/usr/bin/env node
/**
 * הגיבוי היומי — ההחלטות והמבנה, בלי Storage ובלי מייל.
 *   · רץ רק ב-22:00 שעון ישראל (וה-cron יורה בשתי שעות UTC).
 *   · מתחת ל-20MB מצורף, מעל — קישור.
 *   · נשמרים 30 האחרונים, ורק קבצים שלנו נמחקים.
 *   · "ניתן לשחזור" = הקובץ שהורד בחזרה נפרס ותואם למניפסט.
 *   · מבני: הפונקציה מורידה ומאמתת אחרי ההעלאה, מתריעה על כל כשל, ומוגנת.
 * הרצה:  npm run test:backup-mail
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codeOf } from './_code.mjs';

const out = join(mkdtempSync(join(tmpdir(), 'bk-')), 'core.mjs');
execFileSync('npx', ['esbuild', 'supabase/functions/_shared/backup-core.ts', '--bundle', '--format=esm', `--outfile=${out}`, '--log-level=error'], { stdio: 'inherit' });
const core = await import(out);

let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`); };

console.log('\nתזמון:');
check('★ 22:00 בישראל בקיץ = 19:00 UTC → רץ', core.shouldRunNow(new Date('2026-07-01T19:30:00Z')));
check('★ 22:00 בישראל בחורף = 20:00 UTC → רץ', core.shouldRunNow(new Date('2026-12-01T20:30:00Z')));
check('19:00 UTC בחורף (21:00 בישראל) → לא רץ', !core.shouldRunNow(new Date('2026-12-01T19:30:00Z')));
check('20:00 UTC בקיץ (23:00 בישראל) → לא רץ', !core.shouldRunNow(new Date('2026-07-01T20:30:00Z')));
check('שם הקובץ נושא תאריך ושעה בישראל', core.objectName(new Date('2026-07-01T19:05:00Z')) === 'teichtal-2026-07-01-2205.json', core.objectName(new Date('2026-07-01T19:05:00Z')));

console.log('\nמצורף או קישור:');
check('★ 19.9MB → מצורף', core.deliveryPlan(19.9 * 1024 * 1024).mode === 'attach');
check('★ 20MB בדיוק → קישור', core.deliveryPlan(20 * 1024 * 1024).mode === 'link');
check('60MB → קישור', core.deliveryPlan(60 * 1024 * 1024).mode === 'link');

console.log('\n30 האחרונים:');
const names = Array.from({ length: 35 }, (_, i) => `teichtal-2026-08-${String(i + 1).padStart(2, '0')}-2200.json`);
const stale = core.pruneList([...names].reverse().concat(['other.txt', 'teichtal-manual.json']));
check('★ 35 גיבויים → 5 הישנים נמחקים', stale.length === 5 && stale[0] === names[0] && stale[4] === names[4], JSON.stringify(stale));
check('קבצים שאינם שלנו לא נמחקים', !stale.includes('other.txt') && !stale.includes('teichtal-manual.json'));
check('30 → כלום', core.pruneList(names.slice(0, 30)).length === 0);

console.log('\nאימות הקובץ שנשמר:');
const good = JSON.stringify({ manifest: { format: 'teichtal-backup/1', taken_at: 'x', counts: { 'public.students': 2, 'auth.users': 1 } }, data: { 'public.students': [{}, {}], 'auth.users': [{}] } });
check('★ קובץ תקין עובר', core.verifyBackupText(good).ok);
check('★ JSON קטוע נופל', !core.verifyBackupText(good.slice(0, -10)).ok);
check('★ טבלה עם פחות שורות מהמניפסט נופלת', !core.verifyBackupText(good.replace('[{},{}]', '[{}]')).ok);
check('★ בלי auth.users נופל (אין שחזור בלי משתמשות)', !core.verifyBackupText(JSON.stringify({ manifest: { format: 'teichtal-backup/1', counts: { 'public.students': 0 } }, data: { 'public.students': [] } })).ok);
check('פורמט זר נופל', !core.verifyBackupText(JSON.stringify({ manifest: { format: 'x', counts: {} }, data: {} })).ok);

console.log('\nמבני:');
const fn = codeOf('supabase/functions/cron-backup/index.ts');
check('★ מוגן: Authorization חייב להיות CRON_SECRET', /Bearer \$\{requireEnv\('CRON_SECRET'\)\}/.test(fn));
check('★ הגיבוי מגיע מ-rpc_backup_dump', /rpc\('rpc_backup_dump'\)/.test(fn));
check('★ אחרי ההעלאה: הורדה בחזרה ואימות', /\.download\(name\)/.test(fn) && /verifyBackupText\(/.test(fn));
check('★ upsert=false — לא דורסים גיבוי קיים', /upsert:\s*false/.test(fn));
check('★ 30 האחרונים דרך pruneList', /pruneList\(/.test(fn) && /KEEP/.test(fn));
check('★ קישור חתום כשגדול, צרופה כשקטן', /createSignedUrl\(/.test(fn) && /attachments:/.test(fn));
check('★ כשל → alertOwner ומייל התראה', /backup_failed/.test(fn) && /הגיבוי היומי נכשל/.test(fn));
check('★ מייל מחובר שלא יצא → alertOwner (לא שקט)', /backup_mail_failed/.test(fn) && /!mail\.ok && to\.length/.test(fn));
check('★ הריצה נרשמת ב-settings.last_backup, בהצלחה ובכשל', (fn.match(/recordRun\(/g) ?? []).length >= 3 && /last_backup/.test(fn));
const mail = codeOf('supabase/functions/_shared/mail.ts');
check('בלי RESEND_API_KEY המייל מוחזר ככשל, לא נבלע', /אין RESEND_API_KEY/.test(mail));
check('mail.ts אינו נוגע בוואטסאפ', !/wa\.ts|sendText/.test(mail));

console.log(fails === 0 ? '\nהגיבוי היומי: ההחלטות נכונות' : `\n${fails} בדיקות נכשלו`);
process.exit(fails ? 1 : 0);
