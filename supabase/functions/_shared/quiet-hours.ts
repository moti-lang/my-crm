type QuietHours = { from: string; to: string; no_shabbat: boolean };

const TZ = 'Asia/Jerusalem';

/** שעה ויום בשבוע לפי שעון ישראל, ללא תלות בשעון השרת. */
function jerusalemParts(d: Date): { minutes: number; weekday: number; ymd: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const days: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: days[parts.weekday ?? 'Sun'] ?? 0,
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/** האם השעה חסומה: שעות שקטות, שבת (משישי בערב), או חג. */
export function isBlocked(at: Date, quiet: QuietHours, holidays: Set<string>): boolean {
  const { minutes, weekday, ymd } = jerusalemParts(at);
  if (holidays.has(ymd)) return true;
  if (quiet.no_shabbat) {
    if (weekday === 6) return true;                      // שבת
    if (weekday === 5 && minutes >= toMinutes('14:00')) return true; // שישי אחה"צ
  }
  const from = toMinutes(quiet.from);
  const to = toMinutes(quiet.to);
  // חלון שחוצה חצות, למשל 21:30–08:00
  return from > to ? minutes >= from || minutes < to : minutes >= from && minutes < to;
}

/**
 * הזמן המותר הבא: 08:00 של יום החול הבא שאינו שבת או חג.
 * מחפש עד 14 יום קדימה ואז נכשל במקום להיתקע.
 */
export function nextAllowedTime(from: Date, quiet: QuietHours, holidays: Set<string>): Date {
  const candidate = new Date(from.getTime());
  for (let i = 0; i < 24 * 14; i++) {
    if (!isBlocked(candidate, quiet, holidays)) return candidate;
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 30);
  }
  throw new Error('לא נמצא חלון שליחה מותר בשבועיים הקרובים');
}
