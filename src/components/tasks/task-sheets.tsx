"use client";

import { useState } from "react";
import { ACTION_META, ACTION_TYPES, HEATS, HEAT_META, LEAD_STATUSES, STATUS_META, type ActionType, type Heat, type LeadStatus } from "@/lib/categories";
import { api, errorMessage } from "@/lib/client/api";
import { emptyNext, nextToIso, type NextActionValue } from "@/lib/client/lead-form-model";
import { fromZonedTime } from "date-fns-tz";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/badge";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { NextActionPicker } from "@/components/leads/next-action-picker";

export interface SheetTask {
  id: string;
  title: string;
  type: string | null;
  leadId: string | null;
  lead?: { phone: string | null; status: string; heat: string } | null;
}

const OUTCOME_CHIPS = ["לא היה / סגור", "דיברנו — מעוניין", "דיברנו — לא עכשיו", "השארתי חומר", "קבענו פגישה", "ביקש הצעת מחיר"];

/** "מה התוצאה?" — מסמן בוצע, יוצר מגע, ומציע תאריך הבא */
export function TaskDoneSheet({ task, open, onClose, onDone }: { task: SheetTask | null; open: boolean; onClose: () => void; onDone: () => void }) {
  const [outcome, setOutcome] = useState("");
  const [touchType, setTouchType] = useState<ActionType | null>(null);
  const [next, setNext] = useState<NextActionValue>(emptyNext());
  const [status, setStatus] = useState<LeadStatus | "">("");
  const [heat, setHeat] = useState<Heat | "">("");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  function reset() {
    setOutcome("");
    setTouchType(null);
    setNext(emptyNext());
    setStatus("");
    setHeat("");
  }

  async function submit(skipDetails = false) {
    if (!task) return;
    setBusy(true);
    try {
      await api(`/api/tasks/${task.id}`, {
        method: "PATCH",
        body: {
          done: true,
          outcome: skipDetails ? null : outcome.trim() || null,
          outcomeTouchType: touchType ?? (task.type as ActionType | null) ?? "VISIT",
          ...(task.leadId && !skipDetails
            ? {
                nextActionAt: nextToIso(next),
                nextActionType: next.date ? (next.type ?? undefined) : undefined,
                nextActionNote: next.date ? next.note || null : null,
                nextActionIsApproximate: next.isApproximate,
                ...(status ? { status } : {}),
                ...(heat ? { heat } : {}),
              }
            : {}),
        },
      });
      toast("סומן כבוצע ✓", "success");
      reset();
      onDone();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open && Boolean(task)}
      onClose={onClose}
      title={`מה התוצאה? — ${task?.title ?? ""}`}
      footer={
        <div className="flex gap-2">
          <Button size="lg" className="flex-1" onClick={() => submit(false)} disabled={busy}>
            {busy ? "שומר…" : "בוצע ושמור"}
          </Button>
          <Button size="lg" variant="outline" onClick={() => submit(true)} disabled={busy}>
            בוצע בלי פרטים
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {OUTCOME_CHIPS.map((c) => (
            <Chip key={c} active={outcome === c} onClick={() => setOutcome(c)}>
              {c}
            </Chip>
          ))}
        </div>
        <Textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="מה קרה? מה סוכם?" className="min-h-20" />
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {ACTION_TYPES.map((t) => (
            <Chip key={t} active={(touchType ?? task?.type) === t} onClick={() => setTouchType(t)}>
              {ACTION_META[t].emoji} {ACTION_META[t].label}
            </Chip>
          ))}
        </div>
        {task?.leadId && (
          <>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Select value={status} onChange={(e) => setStatus(e.target.value as LeadStatus | "")}>
                <option value="">סטטוס — ללא שינוי{task.lead ? ` (${STATUS_META[task.lead.status as LeadStatus]?.label})` : ""}</option>
                {LEAD_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_META[s].label}
                  </option>
                ))}
              </Select>
              <div className="flex gap-2">
                {HEATS.map((h) => (
                  <Chip key={h} active={(heat || task.lead?.heat) === h} onClick={() => setHeat(h)} className="flex-1 justify-center">
                    {HEAT_META[h].emoji} {HEAT_META[h].label}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 font-bold">המעקב הבא</div>
              <NextActionPicker value={next} onChange={setNext} hasPhone={Boolean(task.lead?.phone)} compact />
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

const POSTPONE = [
  { label: "מחר", days: 1 },
  { label: "בעוד 3 ימים", days: 3 },
  { label: "שבוע", days: 7 },
  { label: "שבועיים", days: 14 },
  { label: "חודש", days: 30 },
];

export function PostponeSheet({ task, open, onClose, onDone }: { task: SheetTask | null; open: boolean; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  async function postpone(body: Record<string, unknown>) {
    if (!task) return;
    setBusy(true);
    try {
      await api(`/api/tasks/${task.id}`, { method: "PATCH", body });
      toast("נדחה", "success");
      onDone();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open && Boolean(task)} onClose={onClose} title={`דחה — ${task?.title ?? ""}`}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          {POSTPONE.map((p) => (
            <Button key={p.days} variant="outline" size="lg" disabled={busy} onClick={() => postpone({ postponeDays: p.days })}>
              {p.label}
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Button disabled={!date || busy} onClick={() => postpone({ dueAt: fromZonedTime(`${date}T00:00:00`, "Asia/Jerusalem").toISOString(), allDay: true })}>
            לתאריך
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
