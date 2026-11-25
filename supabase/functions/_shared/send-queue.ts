/**
 * ★ קצב השליחה של התור (cron-reminders). תזכורות יוצאות להרבה הורים באותו נוסח — וזה בדיוק מה
 *   שוואטסאפ חוסם עליו. לכן:
 *   · בין שתי הודעות אמיתיות — מרווח אקראי (min_gap_seconds עד max_gap_seconds), מההגדרות.
 *   · תקרה להודעות בדקה (max_per_minute) — נאכפת במסד (rpc_wa_reserve_send), גם מול שליחות במקביל.
 *     wa-send מחזירה "להמתין X שניות" — ממתינים פעם אחת ומנסים שוב; לא מספיק — עוצרים לסבב הבא.
 *   · סבב אחד מוגבל בזמן (run_budget_seconds). מה שלא הספיק — נשאר בתור, ויוצא בסבב הבא.
 *   · הרצה יבשה — בלי המתנה (שום דבר לא יוצא).
 * כל התלויות (שליחה, שעון, המתנה, אקראיות) מוזרקות — כדי שהבדיקה תריץ את זה בלי לחכות באמת.
 */
export type Pacing = { min_gap_seconds: number; max_gap_seconds: number; max_per_minute: number; run_budget_seconds: number };
export const PACING_DEFAULT: Pacing = { min_gap_seconds: 8, max_gap_seconds: 20, max_per_minute: 4, run_budget_seconds: 110 };

/** מה ש-wa-send החזירה על תזכורת אחת. */
export type SendOutcome = {
  sent?: boolean; dry_run?: boolean; deferred?: boolean; held?: boolean;
  reason?: string; retry_after_seconds?: number; error?: string;
};

export type QueueDeps<R> = {
  send: (r: R) => Promise<SendOutcome>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  pacing: Pacing;
};

export type QueueStats = { sent: number; dry_run: number; deferred: number; failed: number; left: number; stopped: string | null };

/** מרווח אקראי בין min ל-max (כולל), במילישניות. */
export function randomGapMs(p: Pacing, random: () => number): number {
  const lo = Math.max(1, p.min_gap_seconds), hi = Math.max(lo, p.max_gap_seconds);
  return Math.round((lo + random() * (hi - lo)) * 1000);
}

export async function drainQueue<R>(due: R[], deps: QueueDeps<R>): Promise<QueueStats> {
  const start = deps.now(), budget = deps.pacing.run_budget_seconds * 1000;
  const left = () => budget - (deps.now() - start);
  const stats: QueueStats = { sent: 0, dry_run: 0, deferred: 0, failed: 0, left: 0, stopped: null };
  let i = 0;
  for (; i < due.length; i++) {
    if (left() <= 0) { stats.stopped = 'budget'; break; }
    let out = await deps.send(due[i]!);
    // ★ התקרה / המרווח במסד: ממתינים פעם אחת (אם יש זמן בסבב) ומנסים שוב.
    if (out.held && out.reason === 'pacing') {
      const wait = Math.max(1, out.retry_after_seconds ?? deps.pacing.min_gap_seconds) * 1000;
      if (wait >= left()) { stats.stopped = 'pacing'; break; }
      await deps.sleep(wait);
      out = await deps.send(due[i]!);
      if (out.held && out.reason === 'pacing') { stats.stopped = 'pacing'; break; }
    }
    // החיבור נפל / לא מוגדר — אין טעם להמשיך בסבב הזה. התזכורות נשארות בתור.
    if (out.held) { stats.stopped = out.reason ?? 'held'; break; }
    if (out.sent && out.dry_run) stats.dry_run++;
    else if (out.sent) stats.sent++;
    else if (out.deferred) stats.deferred++;
    else stats.failed++;
    // ★ מרווח אקראי — רק אחרי הודעה שיצאה באמת, ורק אם יש עוד מה לשלוח.
    if (out.sent && !out.dry_run && i + 1 < due.length) {
      const gap = randomGapMs(deps.pacing, deps.random);
      if (gap >= left()) { i++; stats.stopped = 'budget'; break; }
      await deps.sleep(gap);
    }
  }
  stats.left = due.length - i;
  return stats;
}
