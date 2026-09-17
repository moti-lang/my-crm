import { describe, expect, it } from "vitest";
import { dateAtIL } from "../dates";
import {
  afterPromiseBuffer,
  checkDateConflict,
  getDayInfoYmd,
  hebrewDateLabel,
  nextFullWorkdayYmd,
  resolveDateExpression,
  upcomingSpecialDays,
} from "../hebrew-dates";

// יום חמישי, ו׳ בתשרי תשפ״ז — בין ראש השנה ליום כיפור
const NOW = dateAtIL("2026-09-17", "09:30");

describe("day info (Israel calendar)", () => {
  it("identifies Shabbat, Yom Kippur, erev, chol hamoed and workdays", () => {
    expect(getDayInfoYmd("2026-09-19").kind).toBe("SHABBAT");
    expect(getDayInfoYmd("2026-09-20").kind).toBe("EREV");
    expect(getDayInfoYmd("2026-09-21").kind).toBe("HOLIDAY");
    expect(getDayInfoYmd("2026-09-21").holidayName).toContain("יום כיפור");
    expect(getDayInfoYmd("2026-09-26").holidayName).toContain("סוכות");
    expect(getDayInfoYmd("2026-09-22").kind).toBe("WORKDAY");
    expect(getDayInfoYmd("2026-09-28").kind).toBe("CHOL_HAMOED");
    expect(getDayInfoYmd("2026-10-03").kind).toBe("HOLIDAY"); // שמיני עצרת (ישראל)
    expect(getDayInfoYmd("2026-10-04").kind).toBe("WORKDAY");
    expect(getDayInfoYmd("2026-09-18").kind).toBe("FRIDAY");
  });
  it("finds the next full workday", () => {
    expect(nextFullWorkdayYmd("2026-09-25")).toBe("2026-10-04");
    expect(nextFullWorkdayYmd("2026-09-22")).toBe("2026-09-22");
  });
  it("checks conflicts and suggests an alternative", () => {
    const c = checkDateConflict(dateAtIL("2026-09-21"));
    expect(c?.level).toBe("block");
    expect(c?.suggestionYmd).toBe("2026-09-22");
    expect(checkDateConflict(dateAtIL("2026-09-28"))?.level).toBe("warn");
    expect(checkDateConflict(dateAtIL("2026-09-22"))).toBeNull();
    expect(checkDateConflict(dateAtIL("2026-09-19"))?.message).toContain("שבת");
  });
  it("lists upcoming special days", () => {
    const days = upcomingSpecialDays("2026-09-17", 30);
    expect(days.some((d) => d.ymd === "2026-09-21")).toBe(true);
    expect(days.some((d) => d.ymd === "2026-09-26")).toBe(true);
  });
  it("renders a Hebrew date label", () => {
    expect(hebrewDateLabel(NOW)).toContain("תשרי");
  });
});

describe("resolveDateExpression", () => {
  const r = (t: string) => resolveDateExpression(t, NOW);

  it("weekday: 'ביום חמישי' → next Thursday (spec example)", () => {
    const res = r("נגריה ליד רחוב הסלע דיברתי עם עדי מבטיחה לחזור ביום חמישי אין טלפון");
    expect(res?.ymd).toBe("2026-09-24");
    expect(res?.isApproximate).toBe(false);
  });
  it("'אחרי החג' → after Yom Kippur", () => {
    const res = r("אמר לחזור אחרי החג");
    expect(res?.ymd).toBe("2026-09-22");
    expect(res?.isApproximate).toBe(true);
  });
  it("'אחרי סוכות' / 'אחרי החגים' → Oct 4", () => {
    expect(r("נדבר אחרי סוכות")?.ymd).toBe("2026-10-04");
    expect(r("אחרי החגים")?.ymd).toBe("2026-10-04");
  });
  it("'בין כיפור לסוכות' → Sep 22", () => {
    expect(r("בין כיפור לסוכות")?.ymd).toBe("2026-09-22");
  });
  it("relative offsets", () => {
    expect(r("בעוד שבוע")?.ymd).toBe("2026-09-24");
    expect(r("מחר")?.ymd).toBe("2026-09-18");
    // 20.9 הוא ערב יום כיפור → מוזז ליום העבודה הבא (22.9)
    expect(r("בעוד 3 ימים")?.ymd).toBe("2026-09-22");
    expect(r("בעוד 3 ימים")?.note).toContain("הוזז");
    expect(r("בעוד שישה ימים")?.ymd).toBe("2026-09-23");
  });
  it("shifts a date that falls on Shabbat/holiday", () => {
    const res = r("בעוד חודש"); // 17.10 = שבת
    expect(res?.ymd).toBe("2026-10-18");
    expect(res?.isApproximate).toBe(true);
    expect(res?.note).toContain("הוזז");
    // "אחרי שבת" → ראשון 20.9 שהוא ערב יום כיפור → שלישי 22.9
    expect(r("אחרי שבת")?.ymd).toBe("2026-09-22");
  });
  it("explicit dates", () => {
    expect(r("נקבע ל-24.9")?.ymd).toBe("2026-09-24");
    expect(r("נקבע ל 5/1")?.ymd).toBe("2027-01-05");
    expect(r("ב-24 לחודש")?.ymd).toBe("2026-09-24");
  });
  it("captures time when explicit", () => {
    const res = r("פגישה ביום שלישי בשעה 10:30");
    expect(res?.ymd).toBe("2026-09-22");
    expect(res?.time).toBe("10:30");
  });
  it("returns null when nothing matches", () => {
    expect(r("נגריה בלי טלפון")).toBeNull();
  });
  it("promise buffer moves the date a day or two later, skipping only closed days", () => {
    expect(afterPromiseBuffer("2026-09-22")).toBe("2026-09-23");
    // 25.9 ערב סוכות (שישי) → 26.9 סוכות → 27.9 ראשון חול המועד (פתוח חלקית)
    expect(afterPromiseBuffer("2026-09-24")).toBe("2026-09-27");
    expect(afterPromiseBuffer("2026-09-17")).toBe("2026-09-18"); // שישי מותר
  });
  it("weekday phrase keeps the leading ב", () => {
    expect(r("מבטיחה לחזור ביום חמישי")?.phrase).toBe("ביום חמישי");
  });
});
