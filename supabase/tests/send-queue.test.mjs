#!/usr/bin/env node
/**
 * ★ קצב השליחה של התור (_shared/send-queue.ts) — עם שעון מזויף, בלי לחכות באמת:
 *   מרווח אקראי בטווח שבהגדרות בין הודעות אמיתיות, בלי מרווח בהרצה יבשה, המתנה אחת כשהמסד אומר
 *   "תקרה / מרווח", עצירה בסוף זמן הסבב (השאר נשאר בתור), ועצירה כשהחיבור נפל.
 *   ובמבנה: cron-reminders שולח רק דרך drainQueue, ו-wa-send שומרת "מקום" לפני כל שליחה אמיתית.
 *   node supabase/tests/send-queue.test.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codeOf } from './_code.mjs';

const out = join(mkdtempSync(join(tmpdir(), 'queue-')), 'q.mjs');
execFileSync('npx', ['esbuild', 'supabase/functions/_shared/send-queue.ts', '--bundle', '--format=esm', `--outfile=${out}`, '--log-level=error'], { stdio: 'inherit' });
const { drainQueue, randomGapMs, PACING_DEFAULT } = await import(out);

let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`); };

function harness(outcomes, pacing = {}, randoms = [0.5]) {
  let t = 0, ri = 0;
  const sleeps = [], sentAt = [], calls = [];
  const queue = [...outcomes];
  return {
    sleeps, sentAt, calls,
    deps: {
      pacing: { ...PACING_DEFAULT, ...pacing },
      now: () => t,
      sleep: async (ms) => { sleeps.push(ms); t += ms; },
      random: () => randoms[ri++ % randoms.length],
      send: async (r) => { calls.push(r); t += 300; const o = typeof queue[0] === 'function' ? queue.shift()(r) : (queue.shift() ?? { sent: true }); if (o.sent && !o.dry_run) sentAt.push(t); return o; },
    },
  };
}
const items = (n) => Array.from({ length: n }, (_, i) => `r${i}`);

console.log('\nמרווח אקראי בין הודעות:');
{
  const h = harness([], {}, [0, 1, 0.25, 0.75]);
  const s = await drainQueue(items(5), h.deps);
  check('★ 5 נשלחו, 4 מרווחים (לא אחרי האחרונה)', s.sent === 5 && h.sleeps.length === 4, JSON.stringify({ s, sleeps: h.sleeps }));
  check('★ כל מרווח בטווח 8–20 שניות, לפי האקראיות', JSON.stringify(h.sleeps) === JSON.stringify([8000, 20000, 11000, 17000]), JSON.stringify(h.sleeps));
  const gaps = h.sentAt.slice(1).map((x, i) => x - h.sentAt[i]);
  check('בפועל — לפחות 8 שניות בין כל שתי הודעות', gaps.every((g) => g >= 8000), JSON.stringify(gaps));
  const many = Array.from({ length: 500 }, () => Math.random());
  const all = many.map((r) => randomGapMs({ ...PACING_DEFAULT, min_gap_seconds: 3, max_gap_seconds: 7 }, () => r));
  check('הטווח מההגדרות (3–7) — תמיד בתוכו', all.every((g) => g >= 3000 && g <= 7000));
  check('מקסימום קטן ממינימום — המינימום', randomGapMs({ ...PACING_DEFAULT, min_gap_seconds: 10, max_gap_seconds: 2 }, () => 0.9) === 10000);
}

console.log('\nהרצה יבשה:');
{
  const h = harness(Array(4).fill({ sent: true, dry_run: true }));
  const s = await drainQueue(items(4), h.deps);
  check('★ בלי מרווחים (שום דבר לא יוצא)', s.dry_run === 4 && h.sleeps.length === 0);
}

console.log('\nתקרה לדקה (מהמסד):');
{
  const h = harness([{ sent: true }, { held: true, reason: 'pacing', retry_after_seconds: 30 }, { sent: true }, { sent: true }]);
  const s = await drainQueue(items(3), h.deps);
  check('★ "להמתין 30 שניות" — ממתינים ומנסים שוב את אותה תזכורת', s.sent === 3 && h.sleeps.includes(30000) && h.calls[1] === 'r1' && h.calls[2] === 'r1', JSON.stringify({ s, calls: h.calls, sleeps: h.sleeps }));
  const h2 = harness([{ sent: true }, { held: true, reason: 'pacing', retry_after_seconds: 5 }, { held: true, reason: 'pacing', retry_after_seconds: 5 }]);
  const s2 = await drainQueue(items(4), h2.deps);
  check('★ שוב "להמתין" — עוצרים; השאר בתור לסבב הבא', s2.sent === 1 && s2.stopped === 'pacing' && s2.left === 3, JSON.stringify(s2));
  const h3 = harness([{ held: true, reason: 'pacing', retry_after_seconds: 500 }]);
  const s3 = await drainQueue(items(2), h3.deps);
  check('המתנה ארוכה מזמן הסבב — לא ממתינים, עוצרים', s3.stopped === 'pacing' && h3.sleeps.length === 0 && s3.left === 2);
}

console.log('\nזמן הסבב:');
{
  const h = harness([], { run_budget_seconds: 60 }, [1]);
  const s = await drainQueue(items(10), h.deps);
  check('★ סבב של 60 שניות עם מרווח 20 — 3 הודעות, 7 נשארות לסבב הבא', s.sent === 3 && s.left === 7 && s.stopped === 'budget', JSON.stringify(s));
}

console.log('\nהחיבור / ההגדרות:');
{
  const h = harness([{ sent: true }, { held: true, reason: 'not_configured' }]);
  const s = await drainQueue(items(5), h.deps);
  check('★ "לא מוגדר" / החיבור נפל — עוצרים מיד, הכל נשאר בתור', s.sent === 1 && s.stopped === 'not_configured' && s.left === 4 && h.calls.length === 2);
  const h2 = harness([{ sent: false, error: 'x' }, { deferred: true }, { sent: true }]);
  const s2 = await drainQueue(items(3), h2.deps);
  check('כישלון / דחייה לשעות מותרות — נספרים, וממשיכים', s2.failed === 1 && s2.deferred === 1 && s2.sent === 1);
}

console.log('\nמבנה:');
{
  const cron = codeOf('supabase/functions/cron-reminders/index.ts');
  check('★ cron-reminders שולח רק דרך drainQueue, עם ההגדרות מהמסד (rpc_wa_pacing)', /await drainQueue\(/.test(cron) && /rpc\('rpc_wa_pacing'\)/.test(cron) && !/for \(const r of due/.test(cron));
  const send = codeOf('supabase/functions/wa-send/index.ts');
  const reserveAt = send.indexOf("rpc('rpc_wa_reserve_send')"), sendAt = send.indexOf('wa.sendText(');
  check('★ wa-send: "מקום" מהמסד לפני כל שליחה אמיתית', reserveAt > 0 && sendAt > reserveAt && /if \(real\) \{/.test(send));
  check('★ wa-send: "לא ברור אם נשלחה" — לא חוזרים', /if \(result\.uncertain\) \{[\s\S]{0,200}break;/.test(send));
  check('★ wa-send: "לא מוגדר" — מוחזקת בתור (לא נכשלת)', /if \(result\.notConfigured\) \{[\s\S]{0,200}held: true/.test(send));
}

console.log(fails === 0 ? '\nקצב השליחה: הכל עבר' : `\n${fails} בדיקות נכשלו`);
process.exit(fails === 0 ? 0 : 1);
