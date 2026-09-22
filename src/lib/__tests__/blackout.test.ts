/**
 * חסימת התראות: שבת, יום טוב, ערב שבת, ערב יום טוב, חול המועד (לפי הגדרה).
 * לפי תאריך בשעון ישראל, לוח ארץ ישראל.
 */
import { describe, expect, it } from "vitest";
import { HebrewCalendar, flags } from "@hebcal/core";
import { dateAtIL } from "../dates";
import {
  afterPromiseBuffer,
  blackoutDaysInRange,
  blackoutReasonAt,
  blackoutReasonYmd,
  checkDateConflict,
  getDayInfoYmd,
  nextAllowedDayYmd,
  resolveDateExpression,
  type CalendarSettings,
} from "../hebrew-dates";
import { evaluateGate, groupDeferred } from "../notify-gate";

const OPEN_CHM: CalendarSettings = { blockCholHamoed: false };

describe("blackoutReasonYmd — לוח תשרי תשפ״ז (ישראל)", () => {
  it("ימי חול רגילים מותרים", () => {
    expect(blackoutReasonYmd("2026-09-17")).toBeNull(); // חמישי
    expect(blackoutReasonYmd("2026-09-22")).toBeNull(); // שלישי אחרי כיפור
    expect(blackoutReasonYmd("2026-10-04")).toBeNull(); // ראשון אחרי שמחת תורה
  });
  it("ערב שבת ושבת חסומים", () => {
    expect(blackoutReasonYmd("2026-09-18")).toBe("EREV_SHABBAT");
    expect(blackoutReasonYmd("2026-09-19")).toBe("SHABBAT");
    expect(blackoutReasonYmd("2026-10-16")).toBe("EREV_SHABBAT");
    expect(blackoutReasonYmd("2026-10-17")).toBe("SHABBAT");
  });
  it("יום טוב וערב יום טוב חסומים — יום כיפור", () => {
    expect(blackoutReasonYmd("2026-09-20")).toBe("EREV_YOM_TOV"); // ראשון, ערב יום כיפור
    expect(blackoutReasonYmd("2026-09-21")).toBe("YOM_TOV"); // יום כיפור
  });
  it("יום טוב גובר על שבת, ערב יום טוב גובר על ערב שבת", () => {
    expect(blackoutReasonYmd("2026-09-25")).toBe("EREV_YOM_TOV"); // שישי, ערב סוכות
    expect(blackoutReasonYmd("2026-09-26")).toBe("YOM_TOV"); // שבת, סוכות א׳
    expect(blackoutReasonYmd("2026-10-02")).toBe("EREV_YOM_TOV"); // שישי, הושענא רבה = ערב שמיני עצרת
    expect(blackoutReasonYmd("2026-10-03")).toBe("YOM_TOV"); // שבת, שמיני עצרת (ישראל: יום אחד)
  });
  it("חול המועד חסום כברירת מחדל, פתוח כשמכבים את ההגדרה", () => {
    for (const d of ["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"]) {
      expect(blackoutReasonYmd(d)).toBe("CHOL_HAMOED");
      expect(blackoutReasonYmd(d, OPEN_CHM)).toBeNull();
    }
  });
  it("ראש השנה: ערב, שני ימי חג", () => {
    expect(blackoutReasonYmd("2026-09-11")).toBe("EREV_YOM_TOV"); // שישי
    expect(blackoutReasonYmd("2026-09-12")).toBe("YOM_TOV");
    expect(blackoutReasonYmd("2026-09-13")).toBe("YOM_TOV");
    expect(blackoutReasonYmd("2026-09-14")).toBeNull();
  });
  it("חגים מודרניים וימי זיכרון אינם חוסמים התראות", () => {
    expect(blackoutReasonYmd("2026-10-22")).toBeNull(); // יום הזיכרון לרבין (חמישי)
    expect(blackoutReasonYmd("2026-11-09")).toBeNull(); // סיגד (שני)
  });
  it("פסח תשפ״ז: ערב, יום טוב, חול המועד, שביעי של פסח", () => {
    // פסח 5787: ערב פסח 21.4.2027 (רביעי), פסח 22.4, חוה״מ 23–27.4, שביעי 28.4
    expect(blackoutReasonYmd("2027-04-21")).toBe("EREV_YOM_TOV");
    expect(blackoutReasonYmd("2027-04-22")).toBe("YOM_TOV");
    expect(blackoutReasonYmd("2027-04-25")).toBe("CHOL_HAMOED");
    expect(blackoutReasonYmd("2027-04-27")).toBe("EREV_YOM_TOV"); // ערב שביעי של פסח
    expect(blackoutReasonYmd("2027-04-28")).toBe("YOM_TOV");
    expect(blackoutReasonYmd("2027-04-29")).toBeNull();
  });
});

describe("לוח ארץ ישראל — יום טוב שני של גלויות אינו חסום", () => {
  const diasporaChag = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return (HebrewCalendar.getHolidaysOnDate(new Date(y, m - 1, d, 12), false) ?? []).some((e) => (e.getFlags() & flags.CHAG) !== 0);
  };
  it("שמחת תורה בגולה (כ״ג תשרי, 4.10.2026) הוא יום חול בישראל", () => {
    expect(diasporaChag("2026-10-04")).toBe(true); // בלוח הגולה זה יום טוב — כאן טעות בהגדרת הלוח הייתה מתגלה
    expect(blackoutReasonYmd("2026-10-04")).toBeNull();
    expect(getDayInfoYmd("2026-10-04").kind).toBe("WORKDAY");
    expect(nextAllowedDayYmd("2026-09-25")).toBe("2026-10-04");
  });
  it("אחרון של פסח בגולה (כ״ב ניסן, 29.4.2027) הוא יום חול בישראל", () => {
    expect(diasporaChag("2027-04-29")).toBe(true);
    expect(blackoutReasonYmd("2027-04-29")).toBeNull();
    expect(getDayInfoYmd("2027-04-29").kind).toBe("WORKDAY");
    expect(blackoutReasonYmd("2027-04-28")).toBe("YOM_TOV"); // שביעי של פסח — כן חסום
  });
  it("יום טוב שני של סוכות בגולה (ט״ז תשרי, 27.9.2026) הוא חול המועד בישראל — נחסם רק לפי ההגדרה, לא כיום טוב", () => {
    expect(diasporaChag("2026-09-27")).toBe(true);
    expect(blackoutReasonYmd("2026-09-27")).toBe("CHOL_HAMOED");
    expect(blackoutReasonYmd("2026-09-27", OPEN_CHM)).toBeNull();
  });
  it("שבועות ב׳ בגולה (12.6.2027) חסום רק מפני שהוא שבת; ערב שבועות ושבועות עצמו חסומים; למחרת מותר", () => {
    expect(diasporaChag("2027-06-12")).toBe(true);
    expect(blackoutReasonYmd("2027-06-12")).toBe("SHABBAT");
    expect(blackoutReasonYmd("2027-06-10")).toBe("EREV_YOM_TOV");
    expect(blackoutReasonYmd("2027-06-11")).toBe("YOM_TOV");
    expect(blackoutReasonYmd("2027-06-13")).toBeNull();
  });
});

describe("blackoutReasonAt — לפי תאריך בשעון ישראל, לא לפי שעה", () => {
  it("כל שעות הערב חסומות, מרגע חצות ישראל", () => {
    expect(blackoutReasonAt(dateAtIL("2026-09-18", "00:00"))).toBe("EREV_SHABBAT");
    expect(blackoutReasonAt(dateAtIL("2026-09-18", "09:30"))).toBe("EREV_SHABBAT");
    expect(blackoutReasonAt(dateAtIL("2026-09-18", "23:59"))).toBe("EREV_SHABBAT");
    expect(blackoutReasonAt(dateAtIL("2026-09-17", "23:59"))).toBeNull();
  });
  it("מוצאי שבת עדיין שבת (לא שולחים במוצ״ש); ראשון 00:00 מותר", () => {
    expect(blackoutReasonAt(dateAtIL("2026-09-19", "22:30"))).toBe("SHABBAT");
    expect(blackoutReasonAt(dateAtIL("2026-09-20", "00:00"))).toBe("EREV_YOM_TOV"); // 20.9 ערב כיפור
    expect(blackoutReasonAt(dateAtIL("2026-10-18", "00:00"))).toBeNull(); // ראשון רגיל
  });
  it("הרגע נבדק בשעון ישראל גם כשה-UTC ביום אחר", () => {
    // 21:30 UTC ביום חמישי 17.9 = 00:30 שישי בישראל
    expect(blackoutReasonAt(new Date("2026-09-17T21:30:00Z"))).toBe("EREV_SHABBAT");
    // 20:59 UTC = 23:59 חמישי בישראל
    expect(blackoutReasonAt(new Date("2026-09-17T20:59:00Z"))).toBeNull();
  });
});

describe("evaluateGate — השער הטהור", () => {
  it("מחזיר allowed=false עם סיבה ותווית", () => {
    const g = evaluateGate(dateAtIL("2026-09-26", "10:00"), { blockCholHamoed: true });
    expect(g).toMatchObject({ allowed: false, reason: "YOM_TOV", label: "יום טוב", ymd: "2026-09-26" });
    expect(evaluateGate(dateAtIL("2026-09-22", "10:00"), { blockCholHamoed: true })).toMatchObject({ allowed: true, reason: null });
  });
});

describe("nextAllowedDayYmd", () => {
  it("מדלג על סוכות כולו כברירת מחדל, ורק על ימי טוב/שבת כשחול המועד פתוח", () => {
    expect(nextAllowedDayYmd("2026-09-24")).toBe("2026-09-24");
    expect(nextAllowedDayYmd("2026-09-25")).toBe("2026-10-04");
    expect(nextAllowedDayYmd("2026-09-25", OPEN_CHM)).toBe("2026-09-27");
    expect(nextAllowedDayYmd("2026-09-18")).toBe("2026-09-22"); // שישי → ראשון ערב כיפור → כיפור → שלישי
  });
  it("רשימת הימים החסומים בטווח", () => {
    const days = blackoutDaysInRange("2026-09-24", 12);
    expect(days.map((d) => d.ymd)).toEqual(["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(days[0].label).toBe("ערב יום טוב");
  });
});

describe("מנוע התאריכים — חול המועד מדולג כמו שבת וחג", () => {
  const NOW = dateAtIL("2026-09-24", "09:00"); // חמישי לפני סוכות
  it("חול המועד: התנגשות ברמת block עם הצעה אחרי החג; פתוח = אזהרה בלבד", () => {
    const c = checkDateConflict(dateAtIL("2026-09-28"));
    expect(c?.level).toBe("block");
    expect(c?.suggestionYmd).toBe("2026-10-04");
    expect(getDayInfoYmd("2026-09-28").message).toContain("לא קובעים");
    expect(checkDateConflict(dateAtIL("2026-09-28"), OPEN_CHM)?.level).toBe("warn");
  });
  it("ביטויים שנופלים על חול המועד מוזזים אחרי החג", () => {
    expect(resolveDateExpression("בעוד 4 ימים", NOW)?.ymd).toBe("2026-10-04"); // 28.9 חוה״מ
    expect(resolveDateExpression("בעוד 4 ימים", NOW, OPEN_CHM)?.ymd).toBe("2026-09-28");
    expect(resolveDateExpression("ביום שלישי", NOW)?.ymd).toBe("2026-10-04"); // 29.9 חוה״מ → מוזז ליום העבודה המלא הבא: ראשון 4.10
    expect(resolveDateExpression("ביום שלישי", NOW)?.note).toContain("הוזז");
  });
  it("הבטיח לחזור ביום חמישי לפני סוכות → המעקב אחרי החגים (או בחול המועד כשהוא פתוח)", () => {
    expect(afterPromiseBuffer("2026-09-24")).toBe("2026-10-04");
    expect(afterPromiseBuffer("2026-09-24", OPEN_CHM)).toBe("2026-09-27");
  });
  it("הושענא רבה נחשב ערב חג גם לקביעת תאריכים", () => {
    const info = getDayInfoYmd("2026-10-02");
    expect(info.kind).toBe("EREV");
    expect(info.isErevYomTov).toBe(true);
    expect(info.severity).toBe("block");
  });
});

describe("groupDeferred — דיגסט אחרי חסימה, מקובץ לפי ליד", () => {
  it("מקבץ לפי ליד עם מונים, ומשאיר פריטים בלי ליד כשורות נפרדות", () => {
    const titles = new Map([
      ["L1", "מוסך דני"],
      ["L2", "טים תאורה"],
    ]);
    const lines = groupDeferred(
      [
        { kind: "reminder", title: "⏰ להיפגש — מוסך דני (1.10 10:00)", body: "", leadId: "L1", count: 1, blockedOn: "2026-09-30", reason: "CHOL_HAMOED" },
        { kind: "contract", title: "חוזה ממתין לחתימה", body: "", leadId: "L2", count: 9, blockedOn: "2026-10-03", reason: "YOM_TOV" },
        { kind: "contract", title: "חוזה ממתין לחתימה", body: "", leadId: "L1", count: 3, blockedOn: "2026-10-03", reason: "YOM_TOV" },
        { kind: "evening", title: "סיכום יום 25.9", body: "2 מגעים · 1 בוצעו\nעוד שורה", leadId: null, count: 1, blockedOn: "2026-09-25", reason: "EREV_YOM_TOV" },
      ],
      titles,
    );
    expect(lines[0]).toBe("🔕 הצטבר בזמן החסימה (25.9–3.10):");
    expect(lines).toContain("• מוסך דני: להיפגש — מוסך דני (1.10 10:00), חוזה ממתין לחתימה ×3");
    expect(lines).toContain("• טים תאורה: חוזה ממתין לחתימה ×9");
    expect(lines).toContain("• סיכום יום 25.9 — 2 מגעים · 1 בוצעו");
    expect(lines).toHaveLength(4);
  });
  it("ריק כשאין פריטים", () => {
    expect(groupDeferred([], new Map())).toEqual([]);
  });
});
