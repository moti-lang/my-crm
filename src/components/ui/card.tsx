import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-border bg-card p-4 shadow-sm", className)} {...props} />;
}

export function SectionTitle({ className, children, count, tone }: { className?: string; children: React.ReactNode; count?: number; tone?: "danger" | "default" | "muted" }) {
  return (
    <h2 className={cn("mb-2 mt-5 flex items-center gap-2 text-base font-bold", tone === "danger" ? "text-danger" : tone === "muted" ? "text-muted-foreground" : "", className)}>
      {children}
      {count !== undefined && <span className={cn("rounded-full px-2 py-0.5 text-xs", tone === "danger" ? "bg-danger/10 text-danger" : "bg-muted text-muted-foreground")}>{count}</span>}
    </h2>
  );
}

export function EmptyState({ icon, title, hint, action }: { icon?: string; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border p-6 text-center">
      {icon && <div className="text-3xl">{icon}</div>}
      <div className="font-medium">{title}</div>
      {hint && <div className="text-sm text-muted-foreground">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn("inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent", className)} aria-label="טוען" />;
}

export function PageTitle({ children, sub, actions }: { children: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">{children}</h1>
        {sub && <div className="text-sm text-muted-foreground">{sub}</div>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}
