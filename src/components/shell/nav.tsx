"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CalendarDays, Footprints, Settings, Sun, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/", label: "היום", icon: Sun },
  { href: "/route", label: "סבב", icon: Footprints },
  { href: "/leads", label: "לידים", icon: Users },
  { href: "/calendar", label: "יומן", icon: CalendarDays },
  { href: "/reports", label: "דוחות", icon: BarChart3 },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppNav() {
  const pathname = usePathname();
  return (
    <>
      {/* מובייל: כותרת עליונה */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/90 px-4 py-2 backdrop-blur md:hidden">
        <Link href="/" className="text-lg font-bold">
          🚶 סבב
        </Link>
        <Link href="/settings" aria-label="הגדרות" className={cn("flex h-11 w-11 items-center justify-center rounded-full", isActive(pathname, "/settings") ? "text-primary" : "text-muted-foreground")}>
          <Settings className="h-6 w-6" />
        </Link>
      </header>

      {/* מובייל: סרגל תחתון */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card md:hidden">
        <ul className="flex items-stretch">
          {ITEMS.map((it) => {
            const active = isActive(pathname, it.href);
            return (
              <li key={it.href} className="flex-1">
                <Link href={it.href} className={cn("flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs", active ? "text-primary" : "text-muted-foreground")}>
                  <it.icon className={cn("h-6 w-6", active && "stroke-[2.5]")} />
                  <span className={cn(active && "font-semibold")}>{it.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* דסקטופ: סרגל צד */}
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-e border-border bg-card p-4 md:flex">
        <Link href="/" className="mb-6 text-2xl font-bold">
          🚶 סבב
        </Link>
        <ul className="flex flex-col gap-1">
          {[...ITEMS, { href: "/settings", label: "הגדרות", icon: Settings }].map((it) => {
            const active = isActive(pathname, it.href);
            return (
              <li key={it.href}>
                <Link href={it.href} className={cn("flex min-h-11 items-center gap-3 rounded-xl px-3 font-medium", active ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted")}>
                  <it.icon className="h-5 w-5" />
                  {it.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="mt-auto text-xs text-muted-foreground">מעקב לידים בשטח</div>
      </aside>
    </>
  );
}
