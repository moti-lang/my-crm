import { Suspense } from "react";
import Link from "next/link";
import { getFilterOptions, listLeads, type LeadFilters as Filters } from "@/lib/leads";
import { agoLabel, relativeDayLabel } from "@/lib/dates";
import { actionEmoji } from "@/lib/categories";
import { displayPhone } from "@/lib/phone";
import { leadTitle, cn } from "@/lib/utils";
import { EmptyState, PageTitle } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { HeatBadge, StatusBadge } from "@/components/ui/domain";
import { LeadFilters } from "@/components/leads/lead-filters";
import { LeadListItem } from "@/components/leads/lead-list-item";

export const dynamic = "force-dynamic";
export const metadata = { title: "לידים" };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const now = new Date();
  const filters: Filters = {
    q: sp.q,
    area: sp.area,
    status: sp.status,
    heat: sp.heat,
    category: sp.category,
    phone: sp.phone as Filters["phone"],
    due: sp.due as Filters["due"],
    stuck: sp.stuck === "1",
    sort: sp.sort as Filters["sort"],
  };
  const [leads, options] = await Promise.all([listLeads(filters, now), getFilterOptions()]);

  return (
    <div>
      <PageTitle actions={<LinkButton href="/leads/new" size="sm">+ ליד חדש</LinkButton>}>לידים</PageTitle>
      <Suspense>
        <LeadFilters areas={options.areas} categories={options.categories} count={leads.length} />
      </Suspense>
      <div className="mt-3">
        {leads.length === 0 ? (
          <EmptyState icon="🔍" title="לא נמצאו לידים" hint="נסה לשנות את הסינון" action={<LinkButton href="/leads/new" size="sm">הוסף ליד</LinkButton>} />
        ) : (
          <>
            {/* מובייל: כרטיסים */}
            <div className="flex flex-col gap-2 md:hidden">
              {leads.map((l) => (
                <LeadListItem key={l.id} lead={l} now={now} />
              ))}
            </div>
            {/* דסקטופ: טבלה */}
            <div className="hidden overflow-x-auto rounded-2xl border border-border bg-card md:block">
              <table className="w-full text-sm">
                <thead className="bg-muted text-start text-muted-foreground">
                  <tr>
                    {["עסק", "אזור", "תחום", "איש קשר", "טלפון", "סטטוס", "חום", "מעקב הבא", "מגע אחרון"].map((h) => (
                      <th key={h} className="px-3 py-2 text-start font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {leads.map((l) => {
                    const overdue = l.nextActionAt && l.nextActionAt < now;
                    return (
                      <tr key={l.id} className="border-t border-border hover:bg-muted/40">
                        <td className="px-3 py-2">
                          <Link href={`/leads/${l.id}`} className="font-semibold hover:underline">
                            {leadTitle(l)}
                          </Link>
                          {l.name && l.descriptor && <div className="text-xs text-muted-foreground">{l.descriptor}</div>}
                        </td>
                        <td className="px-3 py-2">{l.area ?? "—"}</td>
                        <td className="px-3 py-2">{l.category ?? "—"}</td>
                        <td className="px-3 py-2">{l.contactName ?? "—"}</td>
                        <td className="px-3 py-2" dir="ltr">
                          {l.phone ? displayPhone(l.phone) : <span className="text-muted-foreground">בלי טלפון</span>}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={l.status} />
                        </td>
                        <td className="px-3 py-2">
                          <HeatBadge heat={l.heat} />
                        </td>
                        <td className={cn("px-3 py-2", overdue && "text-danger", l.nextActionIsApproximate && "approx")}>
                          {l.nextActionAt ? `${actionEmoji(l.nextActionType)} ${relativeDayLabel(l.nextActionAt, now)}` : "—"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{agoLabel(l.lastTouchAt, now)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
