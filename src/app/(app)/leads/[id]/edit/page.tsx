import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getFilterOptions } from "@/lib/leads";
import { leadToForm } from "@/lib/client/lead-form-model";
import { leadTitle } from "@/lib/utils";
import { PageTitle } from "@/components/ui/card";
import { LeadForm } from "@/components/leads/lead-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "עריכת ליד" };

export default async function EditLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [lead, options] = await Promise.all([prisma.lead.findUnique({ where: { id } }), getFilterOptions()]);
  if (!lead) notFound();
  return (
    <div>
      <Link href={`/leads/${id}`} className="text-sm text-muted-foreground hover:underline">
        ← חזרה לכרטיס
      </Link>
      <PageTitle>עריכה: {leadTitle(lead)}</PageTitle>
      <LeadForm initial={leadToForm(lead)} mode="edit" leadId={id} areas={options.areas} categories={options.categories} />
    </div>
  );
}
