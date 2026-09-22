import { ok, readJson, withErrors } from "@/lib/api-utils";
import { parseLeadText } from "@/lib/parse";
import { getCalendarSettings } from "@/lib/calendar-settings";
import { parseInput } from "@/lib/validation";

export const maxDuration = 60;

/** פירוק טקסט חופשי לליד — Claude (אם מוגדר) עם גיבוי מקומי. התוצאה מוצגת לאישור לפני שמירה. */
export const POST = withErrors(async (req) => {
  const { text } = await readJson(req, parseInput);
  return ok(await parseLeadText(text, new Date(), await getCalendarSettings()));
});
