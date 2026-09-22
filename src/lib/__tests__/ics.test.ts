import { describe, expect, it } from "vitest";
import { dateAtIL } from "../dates";
import { buildIcs } from "../ics";

type Task = Parameters<typeof buildIcs>[0][number];

function task(over: Partial<Task>): Task {
  return {
    id: over.id ?? "t1",
    leadId: null,
    title: "בדיקה",
    dueAt: dateAtIL("2026-09-22"),
    allDay: true,
    isApproximate: false,
    type: "VISIT",
    notes: null,
    source: "MANUAL",
    done: false,
    doneAt: null,
    outcome: null,
    remindMinutesBefore: null,
    notifiedAt: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    lead: null,
    ...over,
  };
}

const alarms = (ics: string) => (ics.match(/BEGIN:VALARM/g) ?? []).length;

describe("ICS — התראות (VALARM) וימים חסומים", () => {
  it("משימה ביום רגיל מקבלת התראה", () => {
    const ics = buildIcs([task({ dueAt: dateAtIL("2026-09-22") })], { appUrl: "https://x" });
    expect(alarms(ics)).toBe(1);
    expect(ics).toContain("TRIGGER;VALUE=DATE-TIME:20260922T050000Z"); // 08:00 ישראל
  });
  it("אין התראה על משימה בשבת, ביום טוב, בערב חג או בחול המועד (ברירת מחדל)", () => {
    const ics = buildIcs(
      [
        task({ id: "sat", dueAt: dateAtIL("2026-09-19") }),
        task({ id: "yk", dueAt: dateAtIL("2026-09-21") }),
        task({ id: "erev", dueAt: dateAtIL("2026-09-25") }),
        task({ id: "chm", dueAt: dateAtIL("2026-09-29") }),
      ],
      { appUrl: "https://x" },
    );
    expect(alarms(ics)).toBe(0);
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(4); // האירועים עצמם נשארים
  });
  it("חול המועד מקבל התראה כשההגדרה כבויה", () => {
    const ics = buildIcs([task({ dueAt: dateAtIL("2026-09-29") })], { appUrl: "https://x", settings: { blockCholHamoed: false } });
    expect(alarms(ics)).toBe(1);
  });
  it("התראה שזמן ההפעלה שלה נופל על יום חסום מושמטת (פגישה ביום ראשון עם התראה יום לפני = שבת)", () => {
    const sunday = task({ dueAt: dateAtIL("2026-10-18", "10:00"), allDay: false, remindMinutesBefore: 24 * 60 });
    expect(alarms(buildIcs([sunday], { appUrl: "https://x" }))).toBe(0);
    const sameDay = task({ dueAt: dateAtIL("2026-10-18", "10:00"), allDay: false, remindMinutesBefore: 30 });
    const ics = buildIcs([sameDay], { appUrl: "https://x" });
    expect(alarms(ics)).toBe(1);
    expect(ics).toContain("TRIGGER:-PT30M");
  });
  it("משימה שבוצעה — בלי התראה", () => {
    expect(alarms(buildIcs([task({ done: true, doneAt: new Date() })], { appUrl: "https://x" }))).toBe(0);
  });
});
