"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, MicOff } from "lucide-react";
import { ACTION_META, ACTION_TYPES, HEATS, HEAT_META, LEAD_STATUSES, STATUS_META, type ActionType, type Heat, type LeadStatus } from "@/lib/categories";
import { errorMessage } from "@/lib/client/api";
import { requestOrQueue } from "@/lib/client/offline-queue";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { emptyNext, instantToNext, nextToIso, type NextActionValue } from "@/lib/client/lead-form-model";
import { useSpeech } from "@/lib/client/use-speech";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/badge";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { NextActionPicker } from "./next-action-picker";

const DURATIONS = [5, 10, 20, 30, 60];
const TZ = "Asia/Jerusalem";

export function TouchForm({
  lead,
  open,
  onClose,
  defaultType,
}: {
  lead: { id: string; phone: string | null; status: string; heat: string; contactName: string | null; nextActionAt: Date | string | null; nextActionType: string | null; nextActionNote: string | null; nextActionIsApproximate: boolean; openTasks: number };
  open: boolean;
  onClose: () => void;
  defaultType?: ActionType;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [type, setType] = useState<ActionType>(defaultType ?? (lead.phone ? "CALL" : "VISIT"));
  const [summary, setSummary] = useState("");
  const [withWhom, setWithWhom] = useState(lead.contactName ?? "");
  const [duration, setDuration] = useState<number | null>(null);
  const [outcome, setOutcome] = useState("");
  const [heat, setHeat] = useState<Heat>(lead.heat as Heat);
  const [status, setStatus] = useState<LeadStatus>(lead.status as LeadStatus);
  const [next, setNext] = useState<NextActionValue>(() => (lead.nextActionAt ? instantToNext(lead.nextActionAt, lead.nextActionType, lead.nextActionNote, lead.nextActionIsApproximate) : emptyNext()));
  const [complete, setComplete] = useState(lead.openTasks > 0);
  const [date, setDate] = useState(() => formatInTimeZone(new Date(), TZ, "yyyy-MM-dd"));
  const [time, setTime] = useState(() => formatInTimeZone(new Date(), TZ, "HH:mm"));
  const [busy, setBusy] = useState(false);

  const onFinal = useCallback((t: string) => setSummary((s) => (s ? `${s} ${t}` : t)), []);
  const speech = useSpeech(onFinal);

  async function submit() {
    if (!summary.trim()) {
      toast("כתוב מה קרה במגע", "error");
      return;
    }
    setBusy(true);
    try {
      const r = await requestOrQueue({
        method: "POST",
        path: `/api/leads/${lead.id}/touches`,
        title: "מגע חדש",
        body: {
          type,
          at: fromZonedTime(`${date}T${time || "00:00"}:00`, TZ).toISOString(),
          summary: summary.trim(),
          withWhom: withWhom.trim() || null,
          durationMin: duration,
          outcome: outcome.trim() || null,
          heat,
          status,
          nextActionAt: nextToIso(next),
          nextActionType: next.date ? next.type ?? undefined : null,
          nextActionNote: next.date ? next.note || null : null,
          nextActionIsApproximate: next.isApproximate,
          completeOpenTasks: complete,
        },
      });
      if (r.queued) toast("אין חיבור — המגע נשמר במכשיר ויסונכרן", "info");
      else toast("המגע נרשם", "success");
      onClose();
      router.refresh();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="הוסף מגע"
      footer={
        <Button size="lg" className="w-full" onClick={submit} disabled={busy}>
          {busy ? "שומר…" : "שמור מגע"}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {ACTION_TYPES.map((t) => (
            <Chip key={t} active={type === t} onClick={() => setType(t)}>
              {ACTION_META[t].emoji} {ACTION_META[t].label}
            </Chip>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="תאריך" />
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="שעה" />
        </div>
        <div className="relative">
          <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="מה קרה? עם מי דיברתי, מה ראיתי, מה סוכם…" className="min-h-28 pe-12" autoFocus />
          {speech.supported && (
            <button type="button" onClick={speech.toggle} className={`absolute end-2 top-2 flex h-10 w-10 items-center justify-center rounded-full ${speech.listening ? "bg-danger text-white" : "bg-muted"}`} aria-label="הכתבה">
              {speech.listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input value={withWhom} onChange={(e) => setWithWhom(e.target.value)} placeholder="עם מי" />
          <Input value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="מה סוכם" />
        </div>
        <div>
          <div className="mb-1 text-sm text-muted-foreground">כמה זמן נתנו לי (דקות)</div>
          <div className="no-scrollbar flex gap-2 overflow-x-auto">
            {DURATIONS.map((d) => (
              <Chip key={d} active={duration === d} onClick={() => setDuration(duration === d ? null : d)}>
                {d}
              </Chip>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          {HEATS.map((h) => (
            <Chip key={h} active={heat === h} onClick={() => setHeat(h)} className="flex-1 justify-center">
              {HEAT_META[h].emoji} {HEAT_META[h].label}
            </Chip>
          ))}
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value as LeadStatus)}>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
            </option>
          ))}
        </Select>
        {lead.openTasks > 0 && (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5" checked={complete} onChange={(e) => setComplete(e.target.checked)} />
            סמן את המשימות הפתוחות של הליד כבוצעו
          </label>
        )}
        <div>
          <div className="mb-2 font-bold">המעקב הבא</div>
          <NextActionPicker value={next} onChange={setNext} hasPhone={Boolean(lead.phone)} compact />
        </div>
      </div>
    </Sheet>
  );
}
