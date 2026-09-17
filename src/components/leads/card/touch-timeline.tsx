"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { Pencil, Trash2 } from "lucide-react";
import { ACTION_META, ACTION_TYPES, actionEmoji, type ActionType } from "@/lib/categories";
import { agoLabel, formatIL, hmIL } from "@/lib/dates";
import { errorMessage } from "@/lib/client/api";
import { requestOrQueue } from "@/lib/client/offline-queue";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/badge";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";

const TZ = "Asia/Jerusalem";
const DURATIONS = [5, 10, 20, 30, 60];

export interface TimelineTouch {
  id: string;
  at: Date;
  type: string;
  withWhom: string | null;
  summary: string;
  outcome: string | null;
  durationMin: number | null;
}

export function TouchTimeline({ touches, now, leadTitle }: { touches: TimelineTouch[]; now: Date; leadTitle: string }) {
  const [editing, setEditing] = useState<TimelineTouch | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  async function remove(t: TimelineTouch) {
    if (!window.confirm("למחוק את המגע הזה מהיומן?")) return;
    try {
      const r = await requestOrQueue({ method: "DELETE", path: `/api/touches/${t.id}`, title: `מחיקת מגע — ${leadTitle}` });
      toast(r.queued ? "אין חיבור — המחיקה תסונכרן" : "המגע נמחק", r.queued ? "info" : "success");
      router.refresh();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  if (touches.length === 0) return <p className="text-sm text-muted-foreground">אין מגעים עדיין. לחץ &quot;הוסף מגע&quot; למעלה.</p>;
  return (
    <>
      <ol className="relative flex flex-col gap-3 border-s-2 border-border ps-4">
        {touches.map((t) => (
          <li key={t.id} className="relative">
            <span className="absolute -start-[1.45rem] top-1 flex h-6 w-6 items-center justify-center rounded-full bg-card text-xs ring-2 ring-border">{actionEmoji(t.type)}</span>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-muted-foreground">
                  {formatIL(t.at, "EEEE d.M.yyyy")} {hmIL(t.at) !== "00:00" && hmIL(t.at)} · {agoLabel(t.at, now)}
                  {t.withWhom && ` · עם ${t.withWhom}`}
                  {t.durationMin != null && ` · ${t.durationMin} דק׳`}
                </div>
                <div className="whitespace-pre-wrap">{t.summary}</div>
                {t.outcome && <div className="text-sm">סוכם: {t.outcome}</div>}
              </div>
              <div className="flex shrink-0 gap-1">
                <button type="button" onClick={() => setEditing(t)} className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted" aria-label="ערוך מגע">
                  <Pencil className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => remove(t)} className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-danger/10 hover:text-danger" aria-label="מחק מגע">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </li>
        ))}
      </ol>
      {editing && <TouchEditSheet touch={editing} leadTitle={leadTitle} onClose={() => setEditing(null)} />}
    </>
  );
}

function TouchEditSheet({ touch, leadTitle, onClose }: { touch: TimelineTouch; leadTitle: string; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [date, setDate] = useState(formatInTimeZone(touch.at, TZ, "yyyy-MM-dd"));
  const [time, setTime] = useState(formatInTimeZone(touch.at, TZ, "HH:mm"));
  const [type, setType] = useState<ActionType>(touch.type as ActionType);
  const [withWhom, setWithWhom] = useState(touch.withWhom ?? "");
  const [summary, setSummary] = useState(touch.summary);
  const [outcome, setOutcome] = useState(touch.outcome ?? "");
  const [duration, setDuration] = useState<number | null>(touch.durationMin);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!summary.trim()) {
      toast("סיכום המגע לא יכול להיות ריק", "error");
      return;
    }
    setBusy(true);
    try {
      const r = await requestOrQueue({
        method: "PATCH",
        path: `/api/touches/${touch.id}`,
        title: `עריכת מגע — ${leadTitle}`,
        coalesceKey: `touch:${touch.id}`,
        body: {
          at: fromZonedTime(`${date}T${time || "00:00"}:00`, TZ).toISOString(),
          type,
          withWhom: withWhom.trim() || null,
          summary: summary.trim(),
          outcome: outcome.trim() || null,
          durationMin: duration,
        },
      });
      toast(r.queued ? "אין חיבור — השינוי יסונכרן" : "המגע עודכן", r.queued ? "info" : "success");
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
      open
      onClose={onClose}
      title="עריכת מגע"
      footer={
        <Button size="lg" className="w-full" onClick={save} disabled={busy}>
          {busy ? "שומר…" : "שמור"}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="תאריך">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="שעה">
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {ACTION_TYPES.map((t) => (
            <Chip key={t} active={type === t} onClick={() => setType(t)}>
              {ACTION_META[t].emoji} {ACTION_META[t].label}
            </Chip>
          ))}
        </div>
        <Field label="עם מי">
          <Input value={withWhom} onChange={(e) => setWithWhom(e.target.value)} />
        </Field>
        <Field label="סיכום">
          <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} className="min-h-24" />
        </Field>
        <Field label="מה סוכם">
          <Input value={outcome} onChange={(e) => setOutcome(e.target.value)} />
        </Field>
        <div>
          <div className="mb-1 text-sm text-muted-foreground">כמה זמן (דקות)</div>
          <div className="no-scrollbar flex gap-2 overflow-x-auto">
            {DURATIONS.map((d) => (
              <Chip key={d} active={duration === d} onClick={() => setDuration(duration === d ? null : d)}>
                {d}
              </Chip>
            ))}
            <Input type="number" inputMode="numeric" min={0} value={duration ?? ""} onChange={(e) => setDuration(e.target.value ? Number(e.target.value) : null)} className="w-24" placeholder="אחר" />
          </div>
        </div>
      </div>
    </Sheet>
  );
}
