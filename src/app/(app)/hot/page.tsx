import { listLeads } from "@/lib/leads";
import { EmptyState, PageTitle } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { LeadListItem } from "@/components/leads/lead-list-item";

export const dynamic = "force-dynamic";
export const metadata = { title: "לידים חמים" };

/** כל הלידים החמים — מהכי דחוף (מעקב הבא) */
export default async function HotLeadsPage() {
  const now = new Date();
  const leads = await listLeads({ heat: "HOT", sort: "next" }, now);
  return (
    <div>
      <PageTitle sub={`${leads.length} לידים`}>🔥 לידים חמים</PageTitle>
      {leads.length === 0 ? (
        <EmptyState icon="🔥" title="אין כרגע לידים חמים" hint="לוחצים על ״חם״ בליד כדי שיופיע כאן" action={<LinkButton href="/leads" size="sm">לכל הלידים</LinkButton>} />
      ) : (
        <div className="flex flex-col gap-2 md:grid md:grid-cols-2">
          {leads.map((l) => (
            <LeadListItem key={l.id} lead={l} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}
