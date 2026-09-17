"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";

export function Fab() {
  const pathname = usePathname();
  if (pathname === "/leads/new") return null;
  return (
    <Link
      href="/leads/new"
      aria-label="הוספה מהירה"
      className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] end-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95 md:bottom-8 md:end-8 md:h-16 md:w-16"
    >
      <Plus className="h-8 w-8" />
    </Link>
  );
}
