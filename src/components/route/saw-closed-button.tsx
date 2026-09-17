"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DoorClosed } from "lucide-react";
import { errorMessage } from "@/lib/client/api";
import { requestOrQueue } from "@/lib/client/offline-queue";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/** "ראיתי שסגור" — רישום מהיר בלי טופס, מזיז את המעקב ליום העבודה הבא */
export function SawClosedButton({ leadId, size = "sm" }: { leadId: string; size?: "sm" | "md" }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  async function click() {
    setBusy(true);
    try {
      const r = await requestOrQueue({ method: "POST", path: `/api/leads/${leadId}/closed`, title: "ראיתי שסגור" });
      toast(r.queued ? "אין חיבור — יירשם כשיחזור חיבור" : "נרשם: סגור. המעקב הוזז ליום העבודה הבא", r.queued ? "info" : "success");
      router.refresh();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="outline" size={size} onClick={click} disabled={busy}>
      <DoorClosed className="h-4 w-4" /> ראיתי שסגור
    </Button>
  );
}
