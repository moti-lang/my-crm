import { getSetting, setSetting } from "./settings";
import { DEFAULT_CALENDAR_SETTINGS, type CalendarSettings } from "./hebrew-dates";

let cache: { value: CalendarSettings; at: number } | null = null;
const TTL = 60_000;

/** הגדרות לוח (חול המועד חסום?) מטבלת Setting, עם cache של דקה */
export async function getCalendarSettings(): Promise<CalendarSettings> {
  if (cache && Date.now() - cache.at < TTL) return cache.value;
  const v = await getSetting("blockCholHamoed");
  const value: CalendarSettings = { blockCholHamoed: v === null ? DEFAULT_CALENDAR_SETTINGS.blockCholHamoed : v === "1" };
  cache = { value, at: Date.now() };
  return value;
}

export async function setCalendarSettings(patch: Partial<CalendarSettings>): Promise<CalendarSettings> {
  if (patch.blockCholHamoed !== undefined) await setSetting("blockCholHamoed", patch.blockCholHamoed ? "1" : "0");
  cache = null;
  return getCalendarSettings();
}

export function clearCalendarSettingsCache() {
  cache = null;
}
