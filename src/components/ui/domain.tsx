import { CalendarClock, Footprints, Mail, MessageCircle, Phone, type LucideProps } from "lucide-react";
import { Badge } from "./badge";
import { ACTION_META, HEAT_META, STATUS_META, type ActionType, type Heat, type LeadStatus } from "@/lib/categories";
import { cn } from "@/lib/utils";

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const m = STATUS_META[status as LeadStatus];
  return <Badge className={cn(m?.cls ?? "bg-muted", className)}>{m?.label ?? status}</Badge>;
}

export function HeatBadge({ heat, className, short }: { heat: string; className?: string; short?: boolean }) {
  const m = HEAT_META[heat as Heat];
  if (!m) return null;
  return (
    <Badge className={cn(m.cls, className)} title={m.hint}>
      {m.emoji}
      {!short && <span>{m.label}</span>}
    </Badge>
  );
}

const ICONS: Record<ActionType, React.ComponentType<LucideProps>> = {
  VISIT: Footprints,
  CALL: Phone,
  EMAIL: Mail,
  MEETING: CalendarClock,
  WHATSAPP: MessageCircle,
};

export function ActionIcon({ type, className }: { type?: string | null; className?: string }) {
  const Icon = type ? ICONS[type as ActionType] : null;
  if (!Icon) return <span className={cn("inline-block h-5 w-5", className)} />;
  return <Icon className={cn("h-5 w-5", className)} aria-label={ACTION_META[type as ActionType]?.label} />;
}

export function NoPhoneTag({ className }: { className?: string }) {
  return <Badge className={cn("bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200", className)}>בלי טלפון</Badge>;
}
