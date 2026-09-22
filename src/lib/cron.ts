/**
 * Cron: נקודת כניסה אחת (tick) שמפעילה עבודות לפי שעון ישראל.
 * מומלץ כל 15 דקות (Vercel Pro או cron-job.org). בתוכנית Hobby של Vercel: פעמיים ביום (05:30 ו-17:30 UTC, ראה vercel.json).
 * מניעת כפילויות דרך טבלת CronRun (job + runKey ייחודיים).
 * כל שליחה עוברת דרך שער ההתראות (notify-gate): בשבת/חג/ערב חג/חול המועד — אפס התראות,
 * ומה שנחסם נכנס לדיגסט הבוקר הראשון שאחרי.
 */
import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "./db";
import { TZ, addDaysIL, dateAtIL, endOfDayIL, formatIL, hmIL, startOfDayIL, weekdayIL, ymdIL } from "./dates";
import { getDailyReport, getStuckLeads, getTodayBoard, getWeeklyReport, leadSummarySelect } from "./leads";
import { buildEveningSummary, buildMorningDigest, buildWeeklySummary, notifyAll } from "./notify";
import { sendPushToAll } from "./push";
import { createSnapshot } from "./snapshot";
import { leadTitle } from "./utils";
import { appUrl } from "./settings";
import { getCalendarSettings } from "./calendar-settings";
import { nextAllowedDayYmd } from "./hebrew-dates";
import { buildDeferredSection, canNotifyAt, deferNotification, markDeferredDelivered, pendingDeferred } from "./notify-gate";

export type JobName = "reminders" | "morning" | "evening" | "weekly" | "automations" | "snapshot";
export const JOB_NAMES: JobName[] = ["reminders", "morning", "evening", "weekly", "automations", "snapshot"];

/** תופס "נעילה" לריצה יומית; מחזיר false אם כבר רצה */
async function claim(job: string, runKey: string): Promise<boolean> {
  try {
    await prisma.cronRun.create({ data: { job, runKey } });
    return true;
  } catch {
    return false;
  }
}
async function release(job: string, runKey: string) {
  await prisma.cronRun.deleteMany({ where: { job, runKey } });
}

/** תזכורות למשימות עם remindMinutesBefore. ביום חסום — נדחות לדיגסט הבא במקום להישלח. */
export async function runReminders(now = new Date()) {
  const gate = await canNotifyAt(now);
  const tasks = await prisma.task.findMany({
    where: {
      done: false,
      remindMinutesBefore: { not: null },
      notifiedAt: null,
      dueAt: { gte: addDaysIL(now, -1), lte: addDaysIL(now, 7) },
    },
    include: { lead: { select: leadSummarySelect } },
  });
  const due = tasks.filter((t) => t.dueAt.getTime() - (t.remindMinutesBefore ?? 0) * 60_000 <= now.getTime());
  let sent = 0;
  let deferred = 0;
  for (const t of due) {
    const when = t.allDay ? formatIL(t.dueAt, "d.M") : `${formatIL(t.dueAt, "d.M")} ${hmIL(t.dueAt)}`;
    const payload = {
      title: `⏰ ${t.title}`,
      body: `${when}${t.lead?.area ? ` · ${t.lead.area}` : ""}${t.notes ? `\n${t.notes}` : ""}`,
      url: t.leadId ? appUrl(`/leads/${t.leadId}`) : appUrl("/"),
      tag: `task-${t.id}`,
    };
    if (!gate.allowed) {
      await deferNotification({ kind: "reminder", title: `${t.title} (${when})`, body: payload.body, url: payload.url, leadId: t.leadId, taskId: t.id }, gate);
      deferred++;
    } else {
      const res = await sendPushToAll(payload, { at: now });
      if (res.sent) sent++;
    }
    await prisma.task.update({ where: { id: t.id }, data: { notifiedAt: now } });
  }
  return { checked: tasks.length, due: due.length, sent, deferred, blocked: !gate.allowed, reason: gate.reason };
}

/** דיגסט בוקר — ביום מותר בלבד; כולל את מה שנחסם מאז הדיגסט הקודם, מקובץ לפי ליד. */
export async function runMorningDigest(now = new Date()) {
  const gate = await canNotifyAt(now);
  if (!gate.allowed) return { blocked: true, reason: gate.reason, text: null };
  const board = await getTodayBoard(now);
  const digest = buildMorningDigest(board, now);
  const deferred = await pendingDeferred();
  let text = digest.text;
  let body = digest.body;
  if (deferred.length) {
    const section = await buildDeferredSection(deferred);
    text = `${text}\n\n${section.join("\n")}`;
    body = `🔕 ${deferred.length} התראות הצטברו בזמן החסימה\n${body}`;
  }
  const res = await notifyAll({ title: digest.title, body, url: appUrl("/"), tag: "morning" }, text, { at: now });
  if (!res.blocked) await markDeferredDelivered(deferred.map((d) => d.id));
  return { ...res, text, deferredDelivered: deferred.length };
}

export async function runEveningSummary(now = new Date()) {
  const gate = await canNotifyAt(now);
  const report = await getDailyReport(now);
  const s = buildEveningSummary(report, now);
  if (!gate.allowed) {
    await deferNotification({ kind: "evening", title: `סיכום יום ${formatIL(now, "d.M")}`, body: s.body, url: appUrl("/reports") }, gate);
    return { blocked: true, reason: gate.reason, deferred: true, text: s.text };
  }
  const res = await notifyAll({ title: s.title, body: s.body, url: appUrl("/reports"), tag: "evening" }, s.text, { at: now });
  return { ...res, text: s.text };
}

export async function runWeeklySummary(now = new Date()) {
  const gate = await canNotifyAt(now);
  const [weekly, stuck] = await Promise.all([getWeeklyReport(now), getStuckLeads(now)]);
  const s = buildWeeklySummary(weekly, stuck);
  if (!gate.allowed) {
    await deferNotification({ kind: "weekly", title: "סיכום שבועי", body: s.body, url: appUrl("/reports?tab=week") }, gate);
    return { blocked: true, reason: gate.reason, deferred: true, text: s.text };
  }
  const res = await notifyAll({ title: s.title, body: s.body, url: appUrl("/reports?tab=week"), tag: "weekly" }, s.text, { at: now });
  return { ...res, text: s.text };
}

/**
 * אוטומציות יומיות: WAITING_THEM שפג + 2 ימים → משימת VISIT (לעולם לא על יום חסום); חוזה מעל 7 ימים → תזכורת.
 */
export async function runAutomations(now = new Date()) {
  const start = startOfDayIL(now);
  const settings = await getCalendarSettings();
  const gate = await canNotifyAt(now);
  const todayYmd = ymdIL(now);
  const dueYmd = nextAllowedDayYmd(todayYmd, settings);
  const dueAt = dateAtIL(dueYmd);
  const shifted = dueYmd !== todayYmd;

  // 1. הבטיחו לחזור ולא חזרו
  const waiting = await prisma.lead.findMany({
    where: { status: "WAITING_THEM", nextActionAt: { lte: addDaysIL(start, -2) } },
    include: { tasks: { where: { done: false, source: "AUTO_WAITING" }, select: { id: true } } },
  });
  let createdVisits = 0;
  for (const lead of waiting) {
    if (lead.tasks.length) continue;
    await prisma.task.create({
      data: {
        leadId: lead.id,
        title: `לקפוץ — ${leadTitle(lead)} (הבטיחו לחזור ולא חזרו)`,
        dueAt,
        allDay: true,
        type: "VISIT",
        source: "AUTO_WAITING",
        notes: `${lead.nextActionNote ? `${lead.nextActionNote}\n` : ""}עברו יומיים מהמועד שהבטיחו — כניסה פיזית${shifted ? ` (נקבע ל-${formatIL(dueAt, "d.M")}, אחרי יום חסום)` : ""}`,
      },
    });
    createdVisits++;
  }

  // 2. חוזה שממתין מעל 7 ימים — תזכורת יומית (ביום חסום: נדחית לדיגסט)
  const contracts = await prisma.lead.findMany({
    where: { status: "CONTRACT", statusChangedAt: { lte: addDaysIL(now, -7) } },
    select: { id: true, name: true, descriptor: true, statusChangedAt: true },
  });
  let contractDeferred = 0;
  for (const lead of contracts) {
    const days = Math.floor((now.getTime() - lead.statusChangedAt.getTime()) / 86_400_000);
    const payload = { title: `📄 חוזה ממתין ${days} ימים`, body: `${leadTitle(lead)} — לבדוק מה קורה עם החתימה`, url: appUrl(`/leads/${lead.id}`), tag: `contract-${lead.id}` };
    if (!gate.allowed) {
      await deferNotification({ kind: "contract", title: "חוזה ממתין לחתימה", body: payload.body, url: payload.url, leadId: lead.id }, gate);
      contractDeferred++;
    } else {
      await sendPushToAll(payload, { at: now });
    }
  }
  return { createdVisits, visitsDueOn: dueYmd, contractReminders: contracts.length, contractDeferred, blocked: !gate.allowed, reason: gate.reason };
}

export async function runSnapshot() {
  return createSnapshot();
}

export async function runJob(job: JobName, now = new Date()): Promise<unknown> {
  switch (job) {
    case "reminders":
      return runReminders(now);
    case "morning":
      return runMorningDigest(now);
    case "evening":
      return runEveningSummary(now);
    case "weekly":
      return runWeeklySummary(now);
    case "automations":
      return runAutomations(now);
    case "snapshot":
      return runSnapshot();
  }
}

/** מפעיל את מה שצריך לרוץ עכשיו לפי שעון ישראל */
export async function runTick(now = new Date(), force: JobName[] = []) {
  const ymd = ymdIL(now);
  const [h, m] = formatInTimeZone(now, TZ, "HH:mm").split(":").map(Number);
  const minutes = h * 60 + m;
  const weekday = weekdayIL(now);
  const gate = await canNotifyAt(now);
  const results: Record<string, unknown> = { at: now.toISOString(), il: formatIL(now, "yyyy-MM-dd HH:mm"), notifications: gate.allowed ? "allowed" : `blocked (${gate.label})` };

  const daily = async (job: JobName, when: boolean, key = ymd) => {
    if (!(force.includes(job) || when)) return;
    const runKey = force.includes(job) ? `${key}:force:${now.getTime()}` : key;
    if (!(await claim(job, runKey))) {
      results[job] = "already-ran";
      return;
    }
    try {
      results[job] = await runJob(job, now);
    } catch (e) {
      results[job] = { error: (e as Error).message };
      console.error(`cron job ${job} failed`, e);
      await release(job, runKey);
    }
  };

  try {
    results.reminders = await runReminders(now);
  } catch (e) {
    results.reminders = { error: (e as Error).message };
  }
  await daily("automations", minutes >= 6 * 60);
  await daily("snapshot", minutes >= 6 * 60);
  await daily("morning", minutes >= 7 * 60 + 30 && minutes < 11 * 60);
  await daily("evening", minutes >= 19 * 60 + 30 && minutes < 24 * 60);
  await daily("weekly", weekday === 0 && minutes >= 6 * 60 && minutes < 11 * 60, `week-${ymd}`);
  results.openUntilTonight = await prisma.task.count({ where: { done: false, dueAt: { lt: endOfDayIL(now) } } });
  return results;
}
