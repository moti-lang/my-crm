import { fail, ok, sp, withErrors } from "@/lib/api-utils";
import { dateAtIL } from "@/lib/dates";
import { BLACKOUT_LABELS, blackoutReasonYmd, checkDateConflict, getDayInfoYmd, hebrewDateLabel, isValidYmd, resolveDateExpression, upcomingSpecialDays } from "@/lib/hebrew-dates";
import { getCalendarSettings } from "@/lib/calendar-settings";

/**
 * GET /api/dates?date=YYYY-MM-DD  → מידע על היום + התנגשות + הצעה
 * GET /api/dates?expr=אחרי החג     → תרגום ביטוי לתאריך
 * GET /api/dates?upcoming=60       → ימים מיוחדים קרובים
 */
export const GET = withErrors(async (req) => {
  const q = sp(req);
  const date = q.get("date");
  const expr = q.get("expr");
  const settings = await getCalendarSettings();
  if (date) {
    if (!isValidYmd(date)) return fail("תאריך לא תקין", 400);
    const d = dateAtIL(date);
    const blackout = blackoutReasonYmd(date, settings);
    return ok({ info: getDayInfoYmd(date, settings), conflict: checkDateConflict(d, settings), hebrew: hebrewDateLabel(d), blackout, blackoutLabel: blackout ? BLACKOUT_LABELS[blackout] : null });
  }
  if (expr) {
    const r = resolveDateExpression(expr, new Date(), settings);
    if (!r) return ok({ resolved: null });
    return ok({ resolved: r, conflict: checkDateConflict(r.date, settings), hebrew: hebrewDateLabel(r.date) });
  }
  const days = Number(q.get("upcoming") ?? 60);
  const { ymdIL } = await import("@/lib/dates");
  return ok({ upcoming: upcomingSpecialDays(ymdIL(new Date()), Math.min(Math.max(days, 1), 400)) });
});
