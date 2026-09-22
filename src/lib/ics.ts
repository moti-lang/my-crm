/**
 * ייצוא יומן ICS — כל משימה היא אירוע, עם התראה, כדי שהתזכורות יופיעו ביומן הטלפון.
 */
import type { Task } from "@prisma/client";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { TZ, ymdIL } from "./dates";
import { DEFAULT_CALENDAR_SETTINGS, addDaysYmd, blackoutReasonYmd, type CalendarSettings } from "./hebrew-dates";
import { leadTitle } from "./utils";
import { addressString } from "./geo";
import { displayPhone } from "./phone";

type TaskForIcs = Task & {
  lead: { id: string; name: string | null; descriptor: string | null; area: string | null; addressNote: string | null; phone: string | null } | null;
};

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** קיפול שורות ל-75 בתים לפי RFC 5545 */
function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = "";
  let curBytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74;
    if (curBytes + b > limit) {
      out.push(cur);
      cur = ch;
      curBytes = b;
    } else {
      cur += ch;
      curBytes += b;
    }
  }
  out.push(cur);
  return out.join("\r\n ");
}

function utcStamp(d: Date): string {
  return formatInTimeZone(d, "UTC", "yyyyMMdd'T'HHmmss'Z'");
}

export function buildIcs(tasks: TaskForIcs[], opts: { appUrl: string; calName?: string; settings?: CalendarSettings }): string {
  const now = new Date();
  const settings = opts.settings ?? DEFAULT_CALENDAR_SETTINGS;
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Sevev CRM//Field Leads//HE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(opts.calName ?? "סבב — מעקבים")}`,
    `X-WR-TIMEZONE:${TZ}`,
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const t of tasks) {
    const title = `${t.done ? "✓ " : ""}${t.isApproximate ? "≈ " : ""}${t.title}`;
    const descParts: string[] = [];
    if (t.notes) descParts.push(t.notes);
    if (t.lead) {
      descParts.push(`ליד: ${leadTitle(t.lead)}${t.lead.area ? ` · ${t.lead.area}` : ""}`);
      if (t.lead.phone) descParts.push(`טלפון: ${displayPhone(t.lead.phone)}`);
      descParts.push(`${opts.appUrl}/leads/${t.lead.id}`);
    }
    if (t.isApproximate) descParts.push("תאריך משוער");
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${t.id}@sevev-crm`);
    lines.push(`DTSTAMP:${utcStamp(now)}`);
    lines.push(`LAST-MODIFIED:${utcStamp(t.updatedAt)}`);
    if (t.allDay) {
      const ymd = ymdIL(t.dueAt).replace(/-/g, "");
      lines.push(`DTSTART;VALUE=DATE:${ymd}`);
      lines.push(`DTEND;VALUE=DATE:${addDaysYmd(ymdIL(t.dueAt), 1).replace(/-/g, "")}`);
    } else {
      lines.push(`DTSTART:${utcStamp(t.dueAt)}`);
      lines.push(`DTEND:${utcStamp(new Date(t.dueAt.getTime() + 60 * 60 * 1000))}`);
    }
    lines.push(`SUMMARY:${esc(title)}`);
    if (descParts.length) lines.push(`DESCRIPTION:${esc(descParts.join("\n"))}`);
    if (t.lead) {
      const addr = addressString(t.lead);
      if (addr) lines.push(`LOCATION:${esc(addr)}`);
      lines.push(`URL:${opts.appUrl}/leads/${t.lead.id}`);
    }
    lines.push(`STATUS:${t.isApproximate ? "TENTATIVE" : "CONFIRMED"}`);
    // התראות: לא על יום חסום (שבת/חג/ערב/חול המועד), ולא כשזמן ההפעלה נופל על יום חסום
    if (!t.done && !blackoutReasonYmd(ymdIL(t.dueAt), settings)) {
      let trigger: string | null = null;
      if (t.allDay) {
        // 08:00 בבוקר של אותו יום (שעון ישראל) — היום עצמו אינו חסום
        trigger = `TRIGGER;VALUE=DATE-TIME:${utcStamp(fromZonedTime(`${ymdIL(t.dueAt)}T08:00:00`, TZ))}`;
      } else {
        const mins = t.remindMinutesBefore ?? 30;
        const at = new Date(t.dueAt.getTime() - mins * 60_000);
        if (!blackoutReasonYmd(ymdIL(at), settings)) trigger = `TRIGGER:-PT${mins}M`;
      }
      if (trigger) {
        lines.push("BEGIN:VALARM");
        lines.push("ACTION:DISPLAY");
        lines.push(`DESCRIPTION:${esc(t.title)}`);
        lines.push(trigger);
        lines.push("END:VALARM");
      }
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
