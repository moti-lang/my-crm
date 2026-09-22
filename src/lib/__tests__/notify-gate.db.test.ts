/**
 * השער מול DB אמיתי: חסימה, דחייה לדיגסט, קיבוץ לפי ליד, אוטומציות לא על ימים חסומים.
 * רץ רק עם DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("notification gate (DB)", () => {
  let prisma: typeof import("../db").prisma;
  let gate: typeof import("../notify-gate");
  let cron: typeof import("../cron");
  let cal: typeof import("../calendar-settings");
  let push: typeof import("../push");
  let wa: typeof import("../whatsapp");
  let dates: typeof import("../dates");
  let svc: typeof import("../lead-service");
  const leads: string[] = [];
  let originalSetting: string | null = null;

  beforeAll(async () => {
    prisma = (await import("../db")).prisma;
    gate = await import("../notify-gate");
    cron = await import("../cron");
    cal = await import("../calendar-settings");
    push = await import("../push");
    wa = await import("../whatsapp");
    dates = await import("../dates");
    svc = await import("../lead-service");
    originalSetting = (await prisma.setting.findUnique({ where: { key: "blockCholHamoed" } }))?.value ?? null;
    await cal.setCalendarSettings({ blockCholHamoed: true });
    await prisma.deferredNotification.deleteMany({ where: { deliveredAt: null } });
  });
  afterAll(async () => {
    if (leads.length) await prisma.lead.deleteMany({ where: { id: { in: leads } } });
    await prisma.deferredNotification.deleteMany({ where: { OR: [{ leadId: { in: leads } }, { kind: { in: ["evening", "weekly"] } }] } });
    if (originalSetting === null) await prisma.setting.deleteMany({ where: { key: "blockCholHamoed" } });
    else await prisma.setting.update({ where: { key: "blockCholHamoed" }, data: { value: originalSetting } });
    cal.clearCalendarSettingsCache();
    await prisma.$disconnect();
  });

  const FRIDAY = () => dates.dateAtIL("2026-10-16", "09:00");
  const SATURDAY = () => dates.dateAtIL("2026-10-17", "12:00");
  const SUNDAY = () => dates.dateAtIL("2026-10-18", "08:00");

  it("canNotifyAt: שבת חסומה, ראשון מותר, חול המועד לפי ההגדרה", async () => {
    expect((await gate.canNotifyAt(SATURDAY())).allowed).toBe(false);
    expect((await gate.canNotifyAt(SUNDAY())).allowed).toBe(true);
    expect((await gate.canNotifyAt(dates.dateAtIL("2026-09-29", "10:00"))).reason).toBe("CHOL_HAMOED");
    await cal.setCalendarSettings({ blockCholHamoed: false });
    expect((await gate.canNotifyAt(dates.dateAtIL("2026-09-29", "10:00"))).allowed).toBe(true);
    await cal.setCalendarSettings({ blockCholHamoed: true });
  });

  it("כל השולחים חוסמים ביום חסום בלי לשלוח", async () => {
    const p = await push.sendPushToAll({ title: "x", body: "y" }, { at: SATURDAY() });
    expect(p).toMatchObject({ sent: 0, failed: 0, blocked: true, reason: "SHABBAT" });
    const w = await wa.sendWhatsApp("x", { at: FRIDAY() });
    expect(w).toMatchObject({ ok: false, blocked: true, reason: "EREV_SHABBAT" });
  });

  it("תזכורת ביום חסום נדחית לדיגסט ומסומנת כמטופלת (לא תישלח במוצ״ש)", async () => {
    const lead = await svc.createLead({ name: "בדיקה — מוסך שבת", nextActionAt: dates.dateAtIL("2026-10-17", "11:00").toISOString(), nextActionType: "MEETING", nextActionRemindMinutesBefore: 60, phone: "052-3333333" });
    leads.push(lead.id);
    const r = await cron.runReminders(SATURDAY());
    expect(r.blocked).toBe(true);
    expect(r.sent).toBe(0);
    expect(r.deferred).toBeGreaterThanOrEqual(1);
    const task = await prisma.task.findFirstOrThrow({ where: { leadId: lead.id, source: "NEXT_ACTION" } });
    expect(task.notifiedAt).not.toBeNull();
    const deferred = await prisma.deferredNotification.findMany({ where: { leadId: lead.id, deliveredAt: null } });
    expect(deferred).toHaveLength(1);
    expect(deferred[0].kind).toBe("reminder");
    expect(deferred[0].reason).toBe("SHABBAT");
    // ריצה נוספת באותה שבת לא יוצרת תזכורת כפולה
    const again = await cron.runReminders(dates.dateAtIL("2026-10-17", "20:30"));
    expect(again.deferred).toBe(0);
  });

  it("אותה התראה שנחסמת שוב מגדילה מונה במקום שורה חדשה", async () => {
    const lead = await svc.createLead({ name: "בדיקה — חוזה", status: "CONTRACT", phone: "052-4444444" });
    leads.push(lead.id);
    await prisma.lead.update({ where: { id: lead.id }, data: { statusChangedAt: dates.addDaysIL(new Date(), -10) } });
    const g = await gate.canNotifyAt(FRIDAY());
    await gate.deferNotification({ kind: "contract", title: "חוזה ממתין לחתימה", body: "b", leadId: lead.id }, g);
    await gate.deferNotification({ kind: "contract", title: "חוזה ממתין לחתימה", body: "b", leadId: lead.id }, await gate.canNotifyAt(SATURDAY()));
    const rows = await prisma.deferredNotification.findMany({ where: { leadId: lead.id, deliveredAt: null } });
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
    expect(rows[0].blockedOn).toBe("2026-10-17");
  });

  it("דיגסט בוקר ביום חסום לא נשלח; ביום מותר כולל את הפריטים שנדחו, מקובצים לפי ליד, ומסמן אותם כמסופקים", async () => {
    const blocked = await cron.runMorningDigest(SATURDAY());
    expect(blocked).toMatchObject({ blocked: true, reason: "SHABBAT" });
    const pendingBefore = await prisma.deferredNotification.count({ where: { deliveredAt: null } });
    expect(pendingBefore).toBeGreaterThanOrEqual(2);

    const sunday = await cron.runMorningDigest(SUNDAY());
    expect(sunday.blocked).not.toBe(true);
    expect(sunday.text).toContain("הצטבר בזמן החסימה");
    expect(sunday.text).toContain("בדיקה — חוזה: חוזה ממתין לחתימה ×2");
    expect(sunday.text).toContain("בדיקה — מוסך שבת:");
    expect(await prisma.deferredNotification.count({ where: { deliveredAt: null } })).toBe(0);
  });

  it("סיכום ערב ביום חסום נדחה (לא נשלח)", async () => {
    const r = await cron.runEveningSummary(FRIDAY());
    expect(r).toMatchObject({ blocked: true, reason: "EREV_SHABBAT", deferred: true });
    const row = await prisma.deferredNotification.findFirst({ where: { kind: "evening", deliveredAt: null } });
    expect(row?.title).toContain("סיכום יום");
  });

  it("אוטומציות: משימת 'לא חזרו' לא נוצרת על יום חסום אלא על היום המותר הבא", async () => {
    const lead = await svc.createLead({ name: "בדיקה — לא חזרו", status: "WAITING_THEM", nextActionAt: dates.dateAtIL("2026-10-12").toISOString(), nextActionType: "CALL", phone: "052-5555555" });
    leads.push(lead.id);
    const r = await cron.runAutomations(FRIDAY());
    expect(r.visitsDueOn).toBe("2026-10-18");
    const auto = await prisma.task.findFirst({ where: { leadId: lead.id, source: "AUTO_WAITING" } });
    expect(auto).not.toBeNull();
    expect(dates.ymdIL(auto!.dueAt)).toBe("2026-10-18");
    expect(auto!.notes).toContain("אחרי יום חסום");
  });
});
