"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Undo2 } from "lucide-react";
import { api, errorMessage } from "@/lib/client/api";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/** כפתור "דחה" — מסמן את הליד כנדחה (אדום) או מבטל את הסימון */
export function RejectToggle({ leadId, rejected, size = "sm", className }: { leadId: string; rejected: boolean; size?: "sm" | "md"; className?: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [value, setValue] = useState(rejected);
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
      await api(`/api/leads/${leadId}`, { method: "PATCH", body: { rejected: next } });
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
        "inline-flex shrink-0 items-center justify-center gap-1 rounded-full border font-medium transition-colors",
        size === "sm" ? "min-h-9 px-3 text-sm" : "min-h-11 px-4",
        value ? "border-danger bg-danger text-white" : "border-danger/40 text-danger hover:bg-danger/10",
        className,
      )}
    >
      {value ? <Undo2 className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
      {value ? "בטל דחייה" : "דחה"}
    </button>
  );
}
