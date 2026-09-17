import Link from "next/link";
import type { LeadSummary } from "@/lib/leads";
import { agoLabel, relativeDayLabel } from "@/lib/dates";
import { actionEmoji } from "@/lib/categories";
import { leadTitle, truncate, cn } from "@/lib/utils";
import { HeatBadge, NoPhoneTag, StatusBadge } from "@/components/ui/domain";

export function LeadListItem({ lead, now, showObservation }: { lead: LeadSummary; now: Date; showObservation?: boolean }) {
  const overdue = lead.nextActionAt && lead.nextActionAt < now;
  return (
    <Link href={`/leads/${lead.id}`} className="block rounded-2xl border border-border bg-card p-3 shadow-sm transition-colors hover:bg-muted/40">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold">{leadTitle(lead)}</span>
            {lead.name && lead.descriptor && <span className="truncate text-sm text-muted-foreground">· {lead.descriptor}</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            {lead.area && <span>📍 {lead.area}</span>}
            {lead.category && <span>{lead.category}</span>}
            {lead.contactName && <span>👤 {lead.contactName}</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge status={lead.status} />
          <HeatBadge heat={lead.heat} short />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        {lead.nextActionAt ? (
          <span className={cn("rounded-md px-1.5 py-0.5", overdue ? "bg-danger/10 text-danger" : "bg-primary/10 text-primary", lead.nextActionIsApproximate && "approx")}>
            {actionEmoji(lead.nextActionType)} {relativeDayLabel(lead.nextActionAt, now)}
            {lead.nextActionNote ? ` — ${truncate(lead.nextActionNote, 40)}` : ""}
          </span>
        ) : (
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground">בלי מעקב</span>
        )}
        <span className="text-muted-foreground">מגע אחרון: {agoLabel(lead.lastTouchAt, now)}</span>
        {!lead.phone && <NoPhoneTag />}
      </div>
      {showObservation && lead.observation && <div className="mt-2 text-sm">👁 {truncate(lead.observation, 120)}</div>}
    </Link>
  );
}
