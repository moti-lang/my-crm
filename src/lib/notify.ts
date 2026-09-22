/**
 * בניית טקסטים של דיגסטים ושליחה בכל הערוצים (Push + WhatsApp).
 */
import { sendPushToAll, type PushPayload, type PushSendResult } from "./push";
import { sendWhatsApp, type WhatsAppResult } from "./whatsapp";
import { canNotifyAt } from "./notify-gate";
import type { BlackoutReason } from "./hebrew-dates";
import type { DailyReport, LeadSummary, TaskWithLead, TodayBoard, WeeklyReport } from "./leads";
import { leadTitle } from "./utils";
import { actionEmoji, actionLabel, statusLabel } from "./categories";
import { agoLabel, formatIL, hmIL, WEEKDAY_NAMES, weekdayIL } from "./dates";
import { getDayInfo, hebrewDateLabel } from "./hebrew-dates";

export interface NotifyResult {
  push: PushSendResult;
  whatsapp: WhatsAppResult;
  blocked?: boolean;
  reason?: BlackoutReason | null;
}

/** שליחה בכל הערוצים — אחרי השער. ביום חסום לא נשלח דבר. */
export async function notifyAll(push: PushPayload, whatsappText?: string, opts: { at?: Date } = {}): Promise<NotifyResult> {
  const at = opts.at ?? new Date();
  const gate = await canNotifyAt(at);
  if (!gate.allowed) {
    return { push: { configured: false, sent: 0, failed: 0, blocked: true, reason: gate.reason }, whatsapp: { ok: false, blocked: true, reason: gate.reason, error: "blocked" }, blocked: true, reason: gate.reason };
  }
  const [p, w] = await Promise.all([sendPushToAll(push, { at }), whatsappText ? sendWhatsApp(whatsappText, { at }) : Promise.resolve<WhatsAppResult>({ ok: false, error: "skipped" })]);
  return { push: p, whatsapp: w };
}

export function taskLine(t: TaskWithLead): string {
  const lead = t.lead ? leadTitle(t.lead) : "";
  const area = t.lead?.area ? ` (${t.lead.area})` : "";
  const time = t.allDay ? "" : `${hmIL(t.dueAt)} `;
  const approx = t.isApproximate ? "≈" : "";
  const note = t.notes ? ` — ${t.notes}` : "";
  const leadPart = lead && !t.title.includes(lead) ? ` · ${lead}` : "";
  return `${actionEmoji(t.type) || "•"} ${time}${approx}${t.title}${leadPart}${area}${note}`;
}

export function buildMorningDigest(board: TodayBoard, now = new Date()): { title: string; body: string; text: string } {
  const lines: string[] = [`בוקר טוב 🌞 יום ${WEEKDAY_NAMES[weekdayIL(now)]} ${formatIL(now, "d.M")} · ${hebrewDateLabel(now)}`];
  const info = getDayInfo(now);
  if (info.message) lines.push(`⚠️ ${info.message}`);
  if (board.overdue.length) {
    lines.push("", `🔴 באיחור (${board.overdue.length}):`);
    board.overdue.slice(0, 10).forEach((t) => lines.push(taskLine(t)));
    if (board.overdue.length > 10) lines.push(`…ועוד ${board.overdue.length - 10}`);
  }
  lines.push("", board.today.length ? `📋 היום (${board.today.length}):` : "📋 אין משימות להיום");
  board.today.forEach((t) => lines.push(taskLine(t)));
  const next = board.week[0];
  if (next) lines.push("", `בהמשך השבוע: ${board.counts.week} משימות (הקרובה: ${WEEKDAY_NAMES[weekdayIL(next.date)]})`);
  const title = `בוקר טוב — ${board.today.length} היום${board.overdue.length ? `, ${board.overdue.length} באיחור` : ""}`;
  const body = [...board.overdue, ...board.today].slice(0, 4).map(taskLine).join("\n") || "אין משימות להיום. יום טוב!";
  return { title, body, text: lines.join("\n") };
}

export function buildEveningSummary(report: DailyReport, now = new Date()): { title: string; body: string; text: string } {
  const types = Object.entries(report.byType)
    .map(([k, v]) => `${actionLabel(k)} ${v}`)
    .join(", ");
  const lines: string[] = [`סיכום יום 🌙 ${WEEKDAY_NAMES[weekdayIL(now)]} ${formatIL(now, "d.M")}`, ""];
  lines.push(`מגעים: ${report.touches.length}${types ? ` (${types})` : ""}`);
  lines.push(`לידים חדשים: ${report.newLeads.length}`);
  lines.push(`משימות שבוצעו: ${report.doneTasks.length}`);
  if (report.advanced.length) {
    lines.push(`התקדמו: ${report.advanced.length}`);
    report.advanced.forEach((c) => lines.push(`  ✦ ${leadTitle(c.lead)} → ${statusLabel(c.to)}`));
  }
  lines.push(`נשארו פתוחות (עד היום): ${report.openTasks}`);
  if (report.byArea.length) {
    lines.push("", "לפי אזור:");
    report.byArea.forEach((a) => lines.push(`  ${a.area}: ${a.touches} מגעים, ${a.newLeads} חדשים`));
  }
  const title = `סיכום יום — ${report.touches.length} מגעים, ${report.openTasks} פתוחות`;
  const body = `${report.newLeads.length} לידים חדשים · ${report.doneTasks.length} בוצעו · ${report.advanced.length} התקדמו`;
  return { title, body, text: lines.join("\n") };
}

export function buildWeeklySummary(weekly: WeeklyReport, stuck: LeadSummary[]): { title: string; body: string; text: string } {
  const t = weekly.totals;
  const lines: string[] = [`סיכום שבועי 📊 ${formatIL(weekly.start, "d.M")}–${formatIL(new Date(weekly.end.getTime() - 1), "d.M")}`, ""];
  lines.push(`לידים חדשים: ${t.newLeads} · מגעים: ${t.touches} (${t.touchedLeads} עסקים) · בוצעו: ${t.done}`);
  lines.push(`התקדמו לשלב הבא: ${t.progressed} · נסגרו: ${t.won} · ירדו: ${t.lost}`);
  lines.push(`פעילים כרגע: ${t.active} מתוך ${t.total}`);
  if (weekly.progressed.length) {
    lines.push("", "התקדמו:");
    weekly.progressed.slice(0, 10).forEach((c) => lines.push(`  ✦ ${leadTitle(c.lead)} → ${statusLabel(c.to)}`));
  }
  if (stuck.length) {
    lines.push("", `⏸ תקועים (ללא מגע 30+ יום): ${stuck.length}`);
    stuck.slice(0, 10).forEach((l) => lines.push(`  • ${leadTitle(l)}${l.area ? ` (${l.area})` : ""} — ${agoLabel(l.lastTouchAt)}`));
    if (stuck.length > 10) lines.push(`  …ועוד ${stuck.length - 10}`);
  }
  const title = `סיכום שבועי — ${t.newLeads} חדשים, ${t.progressed} התקדמו`;
  const body = `${t.touches} מגעים · ${t.won} נסגרו · ${stuck.length} תקועים`;
  return { title, body, text: lines.join("\n") };
}
