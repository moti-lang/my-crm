import { prisma } from "@/lib/db";
import { leadSummarySelect } from "@/lib/leads";
import { dateAtIL, formatIL, ymdIL } from "@/lib/dates";
import { addDaysYmd, getDayInfoYmd, isValidYmd, weekdayOfYmd } from "@/lib/hebrew-dates";
import { leadTitle } from "@/lib/utils";
import { PageTitle } from "@/components/ui/card";
import { CalendarView, type CalDay, type CalTask } from "@/components/calendar/calendar-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "יומן" };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ view?: string; d?: string }> }) {
  const sp = await searchParams;
  const view = sp.view === "week" ? "week" : "month";
  const today = ymdIL(new Date());
  const anchor = sp.d && isValidYmd(sp.d) ? sp.d : today;

  let from: string;
  let to: string;
  if (view === "month") {
    const first = `${anchor.slice(0, 7)}-01`;
    from = addDaysYmd(first, -weekdayOfYmd(first));
    to = addDaysYmd(from, 42);
  } else {
    from = addDaysYmd(anchor, -weekdayOfYmd(anchor));
    to = addDaysYmd(from, 7);
  }

  const tasks = await prisma.task.findMany({
    where: { dueAt: { gte: dateAtIL(from), lt: dateAtIL(to) } },
    include: { lead: { select: leadSummarySelect } },
    orderBy: [{ dueAt: "asc" }],
  });
  const calTasks: CalTask[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    dueAt: t.dueAt.toISOString(),
    allDay: t.allDay,
    type: t.type,
    done: t.done,
    isApproximate: t.isApproximate,
    notes: t.notes,
    leadId: t.leadId,
    leadTitle: t.lead ? leadTitle(t.lead) : null,
    leadArea: t.lead?.area ?? null,
    leadPhone: t.lead?.phone ?? null,
    leadStatus: t.lead?.status ?? null,
    leadHeat: t.lead?.heat ?? null,
    remindMinutesBefore: t.remindMinutesBefore,
  }));
  const days: CalDay[] = [];
  for (let d = from; d < to; d = addDaysYmd(d, 1)) {
    const info = getDayInfoYmd(d);
    const base = info.holidayName?.replace(/ \d{4}$/, "").replace(/ [א-ז]׳$/, "").replace(/ \(.*\)$/, "");
    const short = !info.holidayName ? undefined : info.kind === "EREV" ? "ערב חג" : info.kind === "CHOL_HAMOED" ? "חוה״מ" : base?.split(" ").slice(0, 2).join(" ");
    days.push({ ymd: d, kind: info.kind, name: info.holidayName, short });
  }
  const monthLabel = view === "month" ? formatIL(dateAtIL(`${anchor.slice(0, 7)}-01`), "MMMM yyyy") : `${formatIL(dateAtIL(from), "d.M")} – ${formatIL(dateAtIL(addDaysYmd(to, -1)), "d.M.yyyy")}`;

  return (
    <div>
      <PageTitle sub="גרירה של אירוע = שינוי תאריך · לחיצה = פרטים">יומן</PageTitle>
      <CalendarView view={view} anchor={anchor} from={from} to={to} today={today} tasks={calTasks} days={days} monthLabel={monthLabel} />
    </div>
  );
}
