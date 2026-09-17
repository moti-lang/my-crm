"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: Array<{ value: T; label: string }>; className?: string }) {
  return (
    <div className={cn("no-scrollbar flex gap-1 overflow-x-auto rounded-xl bg-muted p-1", className)} role="tablist">
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={cn("min-h-10 flex-1 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors", value === it.value ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function LinkTabs({ value, items, className }: { value: string; items: Array<{ value: string; label: string; href: string }>; className?: string }) {
  return (
    <div className={cn("no-scrollbar flex gap-1 overflow-x-auto rounded-xl bg-muted p-1", className)}>
      {items.map((it) => (
        <Link
          key={it.value}
          href={it.href}
          className={cn("min-h-10 flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-center text-sm font-medium transition-colors", value === it.value ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}
        >
          {it.label}
        </Link>
      ))}
    </div>
  );
}
