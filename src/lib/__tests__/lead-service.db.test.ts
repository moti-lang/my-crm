/**
 * בדיקות סנכרון דו-כיווני nextActionAt ↔ משימה, מול Postgres אמיתי.
 * רצות רק כשיש DATABASE_URL (למשל .env מקומי); אחרת מדולגות.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("nextActionAt ↔ Task sync (DB)", () => {
  // ייבוא דינמי כדי שלא ייווצר PrismaClient כשאין DB
  let prisma: typeof import("../db").prisma;
  let svc: typeof import("../lead-service");
  let dates: typeof import("../dates");
  const created: string[] = [];

  beforeAll(async () => {
    prisma = (await import("../db")).prisma;
    svc = await import("../lead-service");
    dates = await import("../dates");
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (e) {
      throw new Error(`DATABASE_URL מוגדר אבל מסד הנתונים לא זמין: ${(e as Error).message}`);
    }
  });
  afterAll(async () => {
    if (created.length) await prisma.lead.deleteMany({ where: { id: { in: created } } });
    await prisma.$disconnect();
  });

  const day = (n: number) => dates.dateAtIL(dates.ymdIL(dates.addDaysIL(new Date(), n)));
  const openTasks = (leadId: string) => prisma.task.findMany({ where: { leadId, done: false }, orderBy: { dueAt: "asc" } });

  it("יצירת ליד עם מעקב יוצרת משימת NEXT_ACTION תואמת (כניסה כשאין טלפון)", async () => {
    const lead = await svc.createLead({ descriptor: "בדיקה — נגריה", area: "בדיקות", nextActionAt: day(3).toISOString(), nextActionNote: "לקפוץ" });
    created.push(lead.id);
    const tasks = await openTasks(lead.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].source).toBe("NEXT_ACTION");
    expect(tasks[0].type).toBe("VISIT");
    expect(tasks[0].dueAt.getTime()).toBe(day(3).getTime());
    expect(tasks[0].notes).toBe("לקפוץ");
  });

  it("שינוי התאריך בליד מעדכן את המשימה המקושרת (ומאפס notifiedAt), בלי ליצור משימה נוספת", async () => {
    const lead = await svc.createLead({ descriptor: "בדיקה — שינוי תאריך", nextActionAt: day(2).toISOString(), nextActionType: "CALL", phone: "052-1111111" });
    created.push(lead.id);
    const [task] = await openTasks(lead.id);
    await prisma.task.update({ where: { id: task.id }, data: { notifiedAt: new Date() } });

    await svc.updateLead(lead.id, { nextActionAt: day(9).toISOString(), nextActionIsApproximate: true, nextActionNote: "אחרי החג" });
    const tasks = await openTasks(lead.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe(task.id);
    expect(tasks[0].dueAt.getTime()).toBe(day(9).getTime());
    expect(tasks[0].isApproximate).toBe(true);
    expect(tasks[0].notes).toBe("אחרי החג");
    expect(tasks[0].notifiedAt).toBeNull();
  });

  it("ביטול המעקב בליד מוחק את המשימה הפתוחה", async () => {
    const lead = await svc.createLead({ descriptor: "בדיקה — ביטול", nextActionAt: day(1).toISOString() });
    created.push(lead.id);
    expect(await openTasks(lead.id)).toHaveLength(1);
    await svc.updateLead(lead.id, { nextActionAt: null });
    expect(await openTasks(lead.id)).toHaveLength(0);
    const fresh = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(fresh.nextActionType).toBeNull();
    expect(fresh.nextActionNote).toBeNull();
  });

  it("דחיית המשימה מעדכנת את nextActionAt של הליד (כיוון הפוך)", async () => {
    const lead = await svc.createLead({ descriptor: "בדיקה — דחייה", nextActionAt: day(1).toISOString() });
    created.push(lead.id);
    const [task] = await openTasks(lead.id);
    await svc.updateTask(task.id, { postponeDays: 4 });
    const fresh = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(fresh.nextActionAt?.getTime()).toBe(day(5).getTime());
    expect((await openTasks(lead.id))[0].dueAt.getTime()).toBe(day(5).getTime());
  });

  it("סימון המשימה כבוצעה יוצר מגע, מנקה את המעקב, ותאריך הבא שנבחר יוצר משימה חדשה", async () => {
    const lead = await svc.createLead({ descriptor: "בדיקה — בוצע", nextActionAt: day(0).toISOString(), phone: "052-2222222" });
    created.push(lead.id);
    const [task] = await openTasks(lead.id);
    await svc.updateTask(task.id, { done: true, outcome: "דיברנו, מעוניין", nextActionAt: day(7).toISOString(), nextActionType: "MEETING", nextActionNote: "פגישה" });
    const fresh = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id }, include: { touches: true, tasks: true } });
    expect(fresh.touches).toHaveLength(1);
    expect(fresh.touches[0].summary).toBe("דיברנו, מעוניין");
    expect(fresh.nextActionAt?.getTime()).toBe(day(7).getTime());
    expect(fresh.nextActionType).toBe("MEETING");
    const open = fresh.tasks.filter((t) => !t.done);
    expect(open).toHaveLength(1);
    expect(open[0].dueAt.getTime()).toBe(day(7).getTime());
    expect(open[0].type).toBe("MEETING");
    expect(fresh.tasks.find((t) => t.id === task.id)?.done).toBe(true);
  });

  it("סימון כבוצע בלי תאריך הבא מנקה את nextActionAt", async () => {
    const lead = await svc.createLead({ descriptor: "בדיקה — בוצע בלי המשך", nextActionAt: day(0).toISOString() });
    created.push(lead.id);
    const [task] = await openTasks(lead.id);
    await svc.updateTask(task.id, { done: true });
    const fresh = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(fresh.nextActionAt).toBeNull();
    expect(await openTasks(lead.id)).toHaveLength(0);
  });

  it("מגע עם השלמת משימות פתוחות ומעקב חדש: הישנה בוצעה, חדשה נוצרה, lastTouchAt התעדכן", async () => {
    const lead = await svc.createLead({ descriptor: "בדיקה — מגע", nextActionAt: day(0).toISOString() });
    created.push(lead.id);
    const before = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    await svc.addTouch(lead.id, { type: "VISIT", summary: "היה סגור", completeOpenTasks: true, nextActionAt: day(2).toISOString(), nextActionType: "VISIT" });
    const fresh = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id }, include: { tasks: true } });
    expect(fresh.tasks.filter((t) => t.done)).toHaveLength(1);
    const open = fresh.tasks.filter((t) => !t.done);
    expect(open).toHaveLength(1);
    expect(open[0].dueAt.getTime()).toBe(day(2).getTime());
    expect(fresh.lastTouchAt.getTime()).toBeGreaterThanOrEqual(before.lastTouchAt.getTime());
  });

  it("עריכה ומחיקה של מגע מעדכנות את lastTouchAt", async () => {
    const lead = await svc.createLead({ descriptor: "בדיקה — עריכת מגע", initialTouch: { type: "VISIT", summary: "ראשון", at: day(-5).toISOString() } });
    created.push(lead.id);
    const { touch } = await svc.addTouch(lead.id, { type: "CALL", summary: "שני", at: day(-1).toISOString() });
    let fresh = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(fresh.lastTouchAt.getTime()).toBe(day(-1).getTime());
    await svc.updateTouch(touch.id, { at: day(-3).toISOString(), summary: "שני (תוקן)" });
    fresh = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(fresh.lastTouchAt.getTime()).toBe(day(-3).getTime());
    await svc.deleteTouch(touch.id);
    fresh = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(fresh.lastTouchAt.getTime()).toBe(day(-5).getTime());
  });
});
