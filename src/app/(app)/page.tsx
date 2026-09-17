import Link from "next/link";
import { getTodayBoard } from "@/lib/leads";
import { WEEKDAY_NAMES, formatIL, weekdayIL } from "@/lib/dates";
import { getDayInfo, hebrewDateLabel } from "@/lib/hebrew-dates";
import { EmptyState, PageTitle, SectionTitle } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { TaskList } from "@/components/tasks/task-list";
import { ActionIcon } from "@/components/ui/domain";
import { leadTitle } from "@/lib/utils";
import { hmIL } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const now = new Date();
  const board = await getTodayBoard(now);
  const info = getDayInfo(now);

  return (
    <div>
      <PageTitle sub={`יום ${WEEKDAY_NAMES[weekdayIL(now)]} ${formatIL(now, "d.M")} · ${hebrewDateLabel(now)}`} actions={<LinkButton href="/route" variant="outline" size="sm">🚶 סבב שטח</LinkButton>}>
        מה אני עושה עכשיו?
      </PageTitle>
      {info.message && <div className="mb-3 rounded-xl bg-warning/10 px-3 py-2 text-sm text-warning">⚠️ {info.message}</div>}
      <p className="mb-1 text-xs text-muted-foreground md:hidden">החלקה ימינה = בוצע · החלקה שמאלה = דחייה</p>

      {board.overdue.length > 0 && (
        <>
          <SectionTitle tone="danger" count={board.overdue.length}>
            באיחור
          </SectionTitle>
          <TaskList tasks={board.overdue} variant="overdue" />
        </>
      )}

      <SectionTitle count={board.today.length}>היום</SectionTitle>
      {board.today.length ? (
        <TaskList tasks={board.today} variant="today" />
      ) : (
        <EmptyState icon="☀️" title="אין משימות להיום" hint={board.overdue.length ? "אבל יש באיחור למעלה" : "זמן טוב לסבב באזור חדש"} action={<LinkButton href="/route" variant="outline" size="sm">פתח סבב שטח</LinkButton>} />
      )}

      <SectionTitle tone="muted" count={board.counts.week}>
        השבוע
      </SectionTitle>
      {board.week.length ? (
        <div className="flex flex-col gap-2">
          {board.week.map((day) => (
            <details key={day.ymd} className="group rounded-2xl border border-border bg-card">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-3 py-2">
                <span className="font-medium">
                  {WEEKDAY_NAMES[weekdayIL(day.date)]} {formatIL(day.date, "d.M")}
                </span>
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  {day.tasks.slice(0, 4).map((t) => (
                    <ActionIcon key={t.id} type={t.type} className="h-4 w-4" />
                  ))}
                  <span>{day.tasks.length}</span>
                </span>
              </summary>
              <ul className="border-t border-border px-3 py-1">
                {day.tasks.map((t) => (
                  <li key={t.id}>
                    <Link href={t.leadId ? `/leads/${t.leadId}` : "/calendar"} className="flex min-h-11 items-center gap-2 text-sm">
                      <ActionIcon type={t.type} className="h-4 w-4 text-primary" />
                      <span className={t.isApproximate ? "approx" : ""}>{t.lead ? leadTitle(t.lead) : t.title}</span>
                      {!t.allDay && <span className="text-xs text-muted-foreground">{hmIL(t.dueAt)}</span>}
                      {t.lead?.area && <span className="text-muted-foreground">· {t.lead.area}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">אין משימות בשבוע הקרוב.</p>
      )}
    </div>
  );
}
