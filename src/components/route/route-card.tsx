import Link from "next/link";
import type { RouteLead } from "@/lib/leads";
import { agoLabel, relativeDayLabel } from "@/lib/dates";
import { actionEmoji, TIME_OF_DAY_META, type TimeOfDay } from "@/lib/categories";
import { leadTitle, truncate, cn } from "@/lib/utils";
import { HeatBadge, NoPhoneTag, StatusBadge } from "@/components/ui/domain";
import { NavButtons, PhoneButtons } from "@/components/leads/lead-actions";
import { SawClosedButton } from "./saw-closed-button";

export function RouteCard({ lead, now }: { lead: RouteLead; now: Date }) {
  const last = lead.touches[0];
  const overdue = lead.nextActionAt && lead.nextActionAt < now;
  return (
    <div className="rounded-2xl border border-border bg-card p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/leads/${lead.id}`} className="min-w-0 flex-1">
          <div className="font-semibold">{leadTitle(lead)}</div>
          <div className="text-sm text-muted-foreground">
            {[lead.category, lead.addressNote, lead.distanceKm != null ? `${lead.distanceKm < 1 ? `${Math.round(lead.distanceKm * 1000)} מ׳` : `${lead.distanceKm.toFixed(1)} ק״מ`}` : null].filter(Boolean).join(" · ")}
            {lead.bestTimeOfDay !== "ANY" && <span className="ms-1 rounded bg-muted px-1 text-xs">{TIME_OF_DAY_META[lead.bestTimeOfDay as TimeOfDay].short}</span>}
          </div>
        </Link>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge status={lead.status} />
          <HeatBadge heat={lead.heat} short />
        </div>
      </div>
      <dl className="mt-2 grid gap-1 text-sm">
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 text-muted-foreground">הייתי לאחרונה</dt>
          <dd>
            {agoLabel(lead.lastTouchAt, now)}
            {last && <span className="text-muted-foreground"> — {truncate(last.summary, 70)}</span>}
          </dd>
        </div>
        {(lead.nextActionNote || last?.outcome) && (
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-muted-foreground">מה הבטיחו</dt>
            <dd>{lead.nextActionNote ?? last?.outcome}</dd>
          </div>
        )}
        {lead.observation && (
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-muted-foreground">מה ראיתי</dt>
            <dd className="font-medium">{truncate(lead.observation, 140)}</dd>
          </div>
        )}
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 text-muted-foreground">מעקב</dt>
          <dd className={cn(overdue ? "text-danger" : "", lead.nextActionIsApproximate && "approx")}>
            {lead.nextActionAt ? `${actionEmoji(lead.nextActionType)} ${relativeDayLabel(lead.nextActionAt, now)}` : "—"}
            {!lead.phone && <NoPhoneTag className="ms-2" />}
          </dd>
        </div>
      </dl>
      <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto">
        <NavButtons target={lead} size="sm" />
        <PhoneButtons phone={lead.phone} size="sm" />
        <SawClosedButton leadId={lead.id} />
      </div>
    </div>
  );
}
