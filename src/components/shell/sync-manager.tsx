"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudOff, RefreshCw } from "lucide-react";
import { QUEUE_EVENT, flushQueue, queuedCount } from "@/lib/client/offline-queue";
import { useToast } from "@/components/ui/toast";

/** מסנכרן לידים שנשמרו אופליין ומציג באנר כשיש פריטים ממתינים */
export function SyncManager() {
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  const refresh = useCallback(async () => setPending(await queuedCount()), []);

  const sync = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await flushQueue();
      if (r.synced) {
        toast(`סונכרנו ${r.synced} שינויים שנשמרו אופליין`, "success");
        router.refresh();
      }
      if (r.failed) toast(`${r.failed} שינויים נדחו על ידי השרת — ראה הגדרות`, "error");
    } finally {
      setBusy(false);
      await refresh();
    }
  }, [busy, refresh, router, toast]);

  useEffect(() => {
    setOnline(navigator.onLine);
    refresh();
    if (navigator.onLine) sync();
    const onOnline = () => {
      setOnline(true);
      sync();
    };
    const onOffline = () => setOnline(false);
    const onQueue = () => refresh();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener(QUEUE_EVENT, onQueue);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener(QUEUE_EVENT, onQueue);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (online && pending === 0) return null;
  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-warning/50 bg-warning/10 px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <CloudOff className="h-5 w-5 text-warning" />
        {!online ? <span>אין חיבור — שינויים ולידים חדשים יישמרו במכשיר{pending ? ` (${pending} ממתינים)` : ""}</span> : <span>{pending} שינויים ממתינים לסנכרון</span>}
      </div>
      {online && pending > 0 && (
        <button type="button" onClick={sync} disabled={busy} className="flex min-h-9 items-center gap-1 rounded-lg bg-warning px-3 text-sm font-medium text-white">
          <RefreshCw className={busy ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> סנכרן
        </button>
      )}
    </div>
  );
}
