import { describe, expect, it } from "vitest";
import { addDaysIL, dateAtIL, diffDaysIL, endOfDayIL, hmIL, relativeDayLabel, startOfDayIL, weekdayIL, ymdIL } from "../dates";

describe("Israel time helpers", () => {
  it("computes the Israel calendar day of an instant", () => {
    // 22:30 UTC on Sep 17 = 01:30 on Sep 18 in Israel (IDT, UTC+3)
    expect(ymdIL(new Date("2026-09-17T22:30:00Z"))).toBe("2026-09-18");
    expect(hmIL(new Date("2026-09-17T22:30:00Z"))).toBe("01:30");
  });
  it("start/end of day are Israel midnight", () => {
    const s = startOfDayIL(new Date("2026-09-17T10:00:00Z"));
    expect(s.toISOString()).toBe("2026-09-16T21:00:00.000Z");
    expect(endOfDayIL(new Date("2026-09-17T10:00:00Z")).toISOString()).toBe("2026-09-17T21:00:00.000Z");
  });
  it("adds days across the DST change (Oct 25, 2026)", () => {
    const before = dateAtIL("2026-10-24", "09:00"); // IDT
    const after = addDaysIL(before, 2); // IST
    expect(ymdIL(after)).toBe("2026-10-26");
    expect(hmIL(after)).toBe("09:00");
    expect(after.toISOString()).toBe("2026-10-26T07:00:00.000Z");
  });
  it("weekday and diff", () => {
    expect(weekdayIL(dateAtIL("2026-09-17"))).toBe(4); // Thursday
    expect(weekdayIL(dateAtIL("2026-09-19"))).toBe(6); // Saturday
    expect(diffDaysIL(dateAtIL("2026-09-17", "23:00"), dateAtIL("2026-09-18", "01:00"))).toBe(1);
  });
  it("relative labels", () => {
    const now = dateAtIL("2026-09-17", "10:00");
    expect(relativeDayLabel(dateAtIL("2026-09-17"), now)).toBe("היום");
    expect(relativeDayLabel(dateAtIL("2026-09-18"), now)).toBe("מחר");
    expect(relativeDayLabel(dateAtIL("2026-09-16"), now)).toBe("אתמול");
    expect(relativeDayLabel(dateAtIL("2026-09-20"), now)).toBe("יום ראשון");
  });
});
