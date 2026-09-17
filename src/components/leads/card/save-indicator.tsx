"use client";

import { AlertTriangle, Check, CloudOff, Loader2 } from "lucide-react";
import type { SaveState } from "@/lib/client/autosave";
import { cn } from "@/lib/utils";

/** אינדיקציית שמירה קצרה — צפה מעל הסרגל התחתון במובייל */
export function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state.status === "idle") return null;
  const cls = {
    dirty: "bg-muted text-muted-foreground",
    saving: "bg-muted text-muted-foreground",
    saved: "bg-success text-white",
    queued: "bg-warning text-white",
    error: "bg-danger text-white",
  }[state.status];
  return (
    <div role="status" aria-live="polite" className={cn("fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] start-4 z-40 flex max-w-[calc(100%-6rem)] items-center gap-2 rounded-full px-3 py-2 text-sm shadow-lg md:bottom-6", cls)}>
      {state.status === "dirty" && <span>עריכה…</span>}
      {state.status === "saving" && (
        <>
          <Loader2 className="h-4 w-4 animate-spin" /> שומר…
        </>
      )}
      {state.status === "saved" && (
        <>
          <Check className="h-4 w-4" /> נשמר
        </>
      )}
      {state.status === "queued" && (
        <>
          <CloudOff className="h-4 w-4" /> נשמר במכשיר, יסונכרן
        </>
      )}
      {state.status === "error" && (
        <>
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="truncate">השמירה נכשלה: {state.message}</span>
          <button type="button" onClick={onRetry} className="shrink-0 rounded-full bg-white/20 px-2 py-0.5 font-medium">
            נסה שוב
          </button>
        </>
      )}
    </div>
  );
}
