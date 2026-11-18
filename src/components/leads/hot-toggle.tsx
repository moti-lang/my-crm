"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Flame } from "lucide-react";
import { api, errorMessage } from "@/lib/client/api";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/** כפתור "חם" — מסמן את הליד כחם (אדום, מופיע בלשונית "חם") או מחזיר לפושר */
export function HotToggle({ leadId, hot, className }: { leadId: string; hot: boolean; className?: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [value, setValue] = useState(hot);
  const [busy, setBusy] = useState(false);

  async function toggle(e: React.MouseEvent) {
    // הכפתור יושב בתוך קישור לכרטיס — לא לפתוח את הכרטיס בלחיצה
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    const next = !value;
    setValue(next);
    setBusy(true);
    try {
      await api(`/api/leads/${leadId}`, { method: "PATCH", body: { heat: next ? "HOT" : "WARM" } });
      router.refresh();
    } catch (err) {
      setValue(!next);
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={value}
      disabled={busy}
      className={cn(
        "inline-flex min-h-9 shrink-0 items-center justify-center gap-1 rounded-full border px-3 text-sm font-medium transition-colors",
        value ? "border-danger bg-danger text-white" : "border-danger/40 text-danger hover:bg-danger/10",
        className,
      )}
    >
      <Flame className="h-4 w-4" />
      {value ? "חם ✓" : "חם"}
    </button>
  );
}
