import Link from "next/link";
import { getAreaReport, getDailyReport, getStuckLeads, getWeeklyReport } from "@/lib/leads";
import { addDaysIL, agoLabel, dateAtIL, formatIL, WEEKDAY_NAMES, weekdayIL, ymdIL } from "@/lib/dates";
import { isValidYmd } from "@/lib/hebrew-dates";
import { actionLabel, statusLabel } from "@/lib/categories";
import { leadTitle } from "@/lib/utils";
import { Card, EmptyState, PageTitle } from "@/components/ui/card";
import { LinkTabs } from "@/components/ui/tabs";
import { LeadListItem } from "@/components/leads/lead-list-item";

export const dynamic = "force-dynamic";
export const metadata = { title: "דוחות" };

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-muted px-3 py-2">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ tab?: string; date?: string }> }) {
  const sp = await searchParams;
  const tab = ["day", "week", "stuck", "area"].includes(sp.tab ?? "") ? sp.tab! : "day";
  const now = new Date();
  const dayYmd = sp.date && isValidYmd(sp.date) ? sp.date : ymdIL(now);
  const dayAt = dateAtIL(dayYmd, "12:00");

  return (
    <div>
      <PageTitle>דוחות</PageTitle>
      <LinkTabs
        value={tab}
        items={[
          { value: "day", label: "סיכום יום", href: "/reports?tab=day" },
          { value: "week", label: "סיכום שבוע", href: "/reports?tab=week" },
          { value: "stuck", label: "תקועים", href: "/reports?tab=stuck" },
          { value: "area", label: "לפי אזור", href: "/reports?tab=area" },
        ]}
      />
      <div className="mt-3">
        {tab === "day" && <DayReport at={dayAt} ymd={dayYmd} />}
        {tab === "week" && <WeekReport now={now} />}
        {tab === "stuck" && <StuckReport now={now} />}
        {tab === "area" && <AreaReportView now={now} />}
      </div>
    </div>
  );
}

async function DayReport({ at, ymd }: { at: Date; ymd: string }) {
  const r = await getDailyReport(at);
  const prev = ymdIL(addDaysIL(at, -1));
  const next = ymdIL(addDaysIL(at, 1));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Link href={`/reports?tab=day&date=${prev}`} className="text-primary">
          → יום קודם
        </Link>
        <div className="font-bold">
          יום {WEEKDAY_NAMES[weekdayIL(at)]} {formatIL(at, "d.M.yyyy")}
        </div>
        <Link href={`/reports?tab=day&date=${next}`} className="text-primary">
          יום הבא ←
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="מגעים" value={r.touches.length} />
        <Stat label="לידים חדשים" value={r.newLeads.length} />
        <Stat label="משימות שבוצעו" value={r.doneTasks.length} />
        <Stat label="התקדמו (תאריך/מסמך)" value={r.advanced.length} />
      </div>
      {Object.keys(r.byType).length > 0 && (
        <Card>
          <div className="mb-1 font-bold">מגעים לפי סוג</div>
          <div className="flex flex-wrap gap-3 text-sm">
            {Object.entries(r.byType).map(([k, v]) => (
              <span key={k}>
                {actionLabel(k)}: <b>{v}</b>
              </span>
            ))}
          </div>
        </Card>
      )}
      {r.byArea.length > 0 && (
        <Card>
          <div className="mb-1 font-bold">לפי אזור</div>
          <table className="w-full text-sm">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 text-start font-medium">אזור</th>
                <th className="py-1 text-start font-medium">מגעים</th>
                <th className="py-1 text-start font-medium">חדשים</th>
              </tr>
            </thead>
            <tbody>
              {r.byArea.map((a) => (
                <tr key={a.area} className="border-t border-border">
                  <td className="py-1">{a.area}</td>
                  <td className="py-1">{a.touches}</td>
                  <td className="py-1">{a.newLeads}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {r.advanced.length > 0 && (
        <Card>
          <div className="mb-1 font-bold">התקדמו היום</div>
          <ul className="text-sm">
            {r.advanced.map((c) => (
              <li key={c.id}>
                <Link href={`/leads/${c.leadId}`} className="font-medium hover:underline">
                  {leadTitle(c.lead)}
                </Link>{" "}
                → {statusLabel(c.to)}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card>
        <div className="mb-1 font-bold">המגעים של היום</div>
        {r.touches.length === 0 ? (
          <p className="text-sm text-muted-foreground">לא נרשמו מגעים ב-{ymd.split("-").reverse().join(".")}.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {r.touches.map((t) => (
              <li key={t.id}>
                <Link href={`/leads/${t.leadId}`} className="font-medium hover:underline">
                  {leadTitle(t.lead)}
                </Link>
                <span className="text-muted-foreground">
                  {" "}
                  · {actionLabel(t.type)} · {formatIL(t.at, "HH:mm")}
                  {t.lead.area ? ` · ${t.lead.area}` : ""}
                </span>
                <div>{t.summary}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="text-sm text-muted-foreground">נשארו פתוחות עד סוף היום: {r.openTasks}</div>
    </div>
  );
}

async function WeekReport({ now }: { now: Date }) {
  const w = await getWeeklyReport(now);
  const t = w.totals;
  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm text-muted-foreground">
        {formatIL(w.start, "d.M")} – {formatIL(new Date(w.end.getTime() - 1), "d.M.yyyy")}
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="לידים חדשים" value={t.newLeads} />
        <Stat label="מגעים" value={`${t.touches} (${t.touchedLeads} עסקים)`} />
        <Stat label="התקדמו לשלב הבא" value={t.progressed} />
        <Stat label="נסגרו / ירדו" value={`${t.won} / ${t.lost}`} />
      </div>
      <Card>
        <div className="mb-1 font-bold">לפי יום</div>
        <table className="w-full text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 text-start font-medium">יום</th>
              <th className="py-1 text-start font-medium">חדשים</th>
              <th className="py-1 text-start font-medium">מגעים</th>
              <th className="py-1 text-start font-medium">בוצעו</th>
            </tr>
          </thead>
          <tbody>
            {w.days.map((d) => (
              <tr key={d.ymd} className="border-t border-border">
                <td className="py-1">
                  {WEEKDAY_NAMES[weekdayIL(d.date)]} {formatIL(d.date, "d.M")}
                </td>
                <td className="py-1">{d.newLeads}</td>
                <td className="py-1">{d.touches}</td>
                <td className="py-1">{d.done}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card>
        <div className="mb-1 font-bold">מגמה</div>
        <p className="text-sm">
          נכנסו {t.newLeads} לידים חדשים מול {t.progressed} שהתקדמו. פעילים כרגע: {t.active} מתוך {t.total}.
        </p>
      </Card>
      {w.progressed.length > 0 && (
        <Card>
          <div className="mb-1 font-bold">התקדמו השבוע</div>
          <ul className="text-sm">
            {w.progressed.map((c) => (
              <li key={c.id}>
                <Link href={`/leads/${c.leadId}`} className="font-medium hover:underline">
                  {leadTitle(c.lead)}
                </Link>{" "}
                → {statusLabel(c.to)} <span className="text-muted-foreground">({formatIL(c.at, "d.M")})</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

async function StuckReport({ now }: { now: Date }) {
  const stuck = await getStuckLeads(now);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">לידים פעילים ללא מגע יותר מ-30 יום, מהישן לחדש.</p>
      {stuck.length === 0 ? <EmptyState icon="🎉" title="אין לידים תקועים" /> : stuck.map((l) => <LeadListItem key={l.id} lead={l} now={now} />)}
    </div>
  );
}

async function AreaReportView({ now }: { now: Date }) {
  const rows = await getAreaReport();
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead className="bg-muted text-muted-foreground">
          <tr>
            {["אזור", "לידים", "פעילים", "חמים", "נסגרו", "המרה", "מגע אחרון"].map((h) => (
              <th key={h} className="px-3 py-2 text-start font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.area} className="border-t border-border">
              <td className="px-3 py-2">
                <Link href={`/leads?area=${encodeURIComponent(r.area)}`} className="font-medium hover:underline">
                  {r.area}
                </Link>
              </td>
              <td className="px-3 py-2">{r.total}</td>
              <td className="px-3 py-2">{r.active}</td>
              <td className="px-3 py-2">{r.hot}</td>
              <td className="px-3 py-2">{r.won}</td>
              <td className="px-3 py-2">{Math.round(r.conversion * 100)}%</td>
              <td className="px-3 py-2 text-muted-foreground">{r.lastTouch ? agoLabel(r.lastTouch, now) : "—"}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-4 text-center text-muted-foreground">
                אין נתונים עדיין
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
