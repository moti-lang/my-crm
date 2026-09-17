import { notFound } from "next/navigation";
import { getLeadFull } from "@/lib/leads";
import { hebrewDateLabel } from "@/lib/hebrew-dates";
import { LeadCard } from "@/components/leads/card/lead-card";

export const dynamic = "force-dynamic";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lead = await getLeadFull(id);
  if (!lead) notFound();
  const now = new Date();
  const openTasks = lead.tasks.filter((t) => !t.done).map((t) => ({ ...t, lead }));
  return <LeadCard lead={lead} openTasks={openTasks} now={now} hebrewNext={lead.nextActionAt ? hebrewDateLabel(lead.nextActionAt) : null} />;
}
