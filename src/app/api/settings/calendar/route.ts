import { z } from "zod";
import { ok, readJson, withErrors } from "@/lib/api-utils";
import { getCalendarSettings, setCalendarSettings } from "@/lib/calendar-settings";
import { BLACKOUT_LABELS, blackoutDaysInRange, blackoutReasonYmd, type CalendarSettings } from "@/lib/hebrew-dates";
import { ymdIL } from "@/lib/dates";

async function payload(settings: CalendarSettings) {
  const today = ymdIL(new Date());
  const reason = blackoutReasonYmd(today, settings);
  return {
    ...settings,
    today: { ymd: today, blocked: Boolean(reason), reason, label: reason ? BLACKOUT_LABELS[reason] : null },
    upcoming: blackoutDaysInRange(today, 30, settings),
  };
}

export const GET = withErrors(async () => ok(await payload(await getCalendarSettings())));

export const PATCH = withErrors(async (req) => {
  const body = await readJson(req, z.object({ blockCholHamoed: z.boolean().optional() }));
  return ok(await payload(await setCalendarSettings(body)));
});
