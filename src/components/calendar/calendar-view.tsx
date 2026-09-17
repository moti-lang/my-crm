"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { ChevronRight, ChevronLeft, Plus } from "lucide-react";
import { ACTION_META, ACTION_TYPES, actionEmoji, type ActionType } from "@/lib/categories";
import { WEEKDAY_NAMES } from "@/lib/dates";
import { addDaysYmd } from "@/lib/hebrew-dates";
import { api, errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { Button, LinkButton } from "@/components/ui/button";
import { Chip } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { PostponeSheet, TaskDoneSheet, type SheetTask } from "@/components/tasks/task-sheets";

const TZ = "Asia/Jerusalem";

export interface CalTask {
  id: string;
  title: string;
  dueAt: string;
  allDay: boolean;
  type: string | null;
  done: boolean;
  isApproximate: boolean;
  notes: string | null;
  leadId: string | null;
  leadTitle: string | null;
  leadArea: string | null;
  leadPhone: string | null;
  leadStatus: string | null;
  leadHeat: string | null;
  remindMinutesBefore: number | null;
}
export interface CalDay {
  ymd: string;
  kind: string;
  name?: string;
  short?: string;
}

function ymdOf(iso: string) {
  return formatInTimeZone(new Date(iso), TZ, "yyyy-MM-dd");
}
function hmOf(iso: string) {
  return formatInTimeZone(new Date(iso), TZ, "HH:mm");
}
function dayNum(ymd: string) {
  return Number(ymd.slice(8, 10));
}

export function CalendarView({ view, anchor, from, to, today, tasks, days, monthLabel }: { view: "month" | "week"; anchor: string; from: string; to: string; today: string; tasks: CalTask[]; days: CalDay[]; monthLabel: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [selected, setSelected] = useState<string>(anchor);
  const [openTask, setOpenTask] = useState<CalTask | null>(null);
  const [doneTask, setDoneTask] = useState<SheetTask | null>(null);
  const [postponeTask, setPostponeTask] = useState<SheetTask | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const byDay = useMemo(() => {
    const m = new Map<string, CalTask[]>();
    for (const t of tasks) {
      const k = ymdOf(t.dueAt);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    }
    return m;
  }, [tasks]);
  const dayInfo = useMemo(() => new Map(days.map((d) => [d.ymd, d])), [days]);

  const cells: string[] = [];
  for (let d = from; d < to; d = addDaysYmd(d, 1)) cells.push(d);

  function nav(delta: number) {
    const next = view === "month" ? shiftMonth(anchor, delta) : addDaysYmd(anchor, 7 * delta);
    router.push(`/calendar?view=${view}&d=${next}`);
  }

  async function moveTask(task: CalTask, ymd: string) {
    const hm = task.allDay ? "00:00" : hmOf(task.dueAt);
    try {
      await api(`/api/tasks/${task.id}`, { method: "PATCH", body: { dueAt: fromZonedTime(`${ymd}T${hm}:00`, TZ).toISOString() } });
      toast("הוזז", "success");
      router.refresh();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  const toSheet = (t: CalTask): SheetTask => ({ id: t.id, title: t.leadTitle ?? t.title, type: t.type, leadId: t.leadId, lead: t.leadId ? { phone: t.leadPhone, status: t.leadStatus ?? "NEW", heat: t.leadHeat ?? "WARM" } : null });

  const pill = (t: CalTask, compact = false) => (
    <button
      key={t.id}
      type="button"
      draggable={!t.done}
      onDragStart={(e) => e.dataTransfer.setData("text/task", t.id)}
      onClick={() => setOpenTask(t)}
      className={cn(
        "flex w-full items-center gap-1 truncate rounded-md px-1.5 text-start text-xs leading-5",
        t.done ? "bg-muted text-muted-foreground line-through" : "bg-primary/10 text-primary",
        t.isApproximate && "approx",
        compact && "text-[11px]",
      )}
      title={t.leadTitle ?? t.title}
    >
      <span>{actionEmoji(t.type) || "•"}</span>
      {!t.allDay && <span className="shrink-0">{hmOf(t.dueAt)}</span>}
      <span className="truncate">{t.leadTitle ?? t.title}</span>
    </button>
  );

  const selectedTasks = byDay.get(selected) ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => nav(-1)} aria-label="קודם">
            <ChevronRight className="h-5 w-5" />
          </Button>
          <Button variant="outline" size="icon" onClick={() => nav(1)} aria-label="הבא">
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <LinkButton href={`/calendar?view=${view}`} variant="ghost" size="sm">
            היום
          </LinkButton>
        </div>
        <div className="font-bold">{monthLabel}</div>
        <div className="flex items-center gap-1">
          <LinkButton href={`/calendar?view=month&d=${anchor}`} variant={view === "month" ? "primary" : "outline"} size="sm">
            חודש
          </LinkButton>
          <LinkButton href={`/calendar?view=week&d=${anchor}`} variant={view === "week" ? "primary" : "outline"} size="sm">
            שבוע
          </LinkButton>
          <Button size="icon" onClick={() => setNewOpen(true)} aria-label="משימה חדשה">
            <Plus className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {view === "month" ? (
        <>
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-2xl border border-border bg-border">
            {WEEKDAY_NAMES.map((n) => (
              <div key={n} className="bg-muted py-1 text-center text-xs font-medium text-muted-foreground">
                {n}
              </div>
            ))}
            {cells.map((ymd) => {
              const list = byDay.get(ymd) ?? [];
              const info = dayInfo.get(ymd);
              const inMonth = ymd.slice(0, 7) === anchor.slice(0, 7);
              const special = info && info.kind !== "WORKDAY" && info.kind !== "FRIDAY" && info.kind !== "SHABBAT";
              return (
                <div
                  key={ymd}
                  onClick={() => setSelected(ymd)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(ymd);
                  }}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(null);
                    const id = e.dataTransfer.getData("text/task");
                    const t = tasks.find((x) => x.id === id);
                    if (t && ymdOf(t.dueAt) !== ymd) moveTask(t, ymd);
                  }}
                  className={cn(
                    "min-h-[64px] cursor-pointer bg-card p-1 md:min-h-[96px]",
                    !inMonth && "opacity-40",
                    ymd === today && "bg-primary/5",
                    ymd === selected && "ring-2 ring-inset ring-primary",
                    dragOver === ymd && "bg-primary/10",
                    (info?.kind === "SHABBAT" || info?.kind === "HOLIDAY") && "bg-muted/60",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className={cn("text-xs font-medium", ymd === today && "rounded-full bg-primary px-1.5 text-primary-foreground")}>{dayNum(ymd)}</span>
                    {special && (
                      <span className="truncate text-[10px] text-warning" title={info?.name}>
                        {info?.short ?? info?.name}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 hidden flex-col gap-0.5 md:flex">
                    {list.slice(0, 3).map((t) => pill(t, true))}
                    {list.length > 3 && <span className="text-[10px] text-muted-foreground">+{list.length - 3}</span>}
                  </div>
                  {list.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-0.5 md:hidden">
                      {list.slice(0, 4).map((t) => (
                        <span key={t.id} className={cn("h-2 w-2 rounded-full", t.done ? "bg-muted-foreground" : "bg-primary")} />
                      ))}
                      {list.length > 4 && <span className="text-[10px]">+{list.length - 4}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <div className="font-bold">
                {WEEKDAY_NAMES[new Date(`${selected}T12:00:00`).getDay()]} {selected.split("-").reverse().slice(0, 2).join(".")}
                {dayInfo.get(selected)?.name && <span className="ms-2 text-sm font-normal text-warning">{dayInfo.get(selected)?.name}</span>}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setNewOpen(true)}>
                + משימה ביום זה
              </Button>
            </div>
            {selectedTasks.length === 0 ? <p className="text-sm text-muted-foreground">אין משימות.</p> : <div className="flex flex-col gap-1">{selectedTasks.map((t) => pill(t))}</div>}
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          {cells.map((ymd) => {
            const list = byDay.get(ymd) ?? [];
            const info = dayInfo.get(ymd);
            return (
              <div
                key={ymd}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(ymd);
                }}
                onDragLeave={() => setDragOver(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(null);
                  const id = e.dataTransfer.getData("text/task");
                  const t = tasks.find((x) => x.id === id);
                  if (t && ymdOf(t.dueAt) !== ymd) moveTask(t, ymd);
                }}
                className={cn("rounded-2xl border border-border bg-card p-3", ymd === today && "border-primary", dragOver === ymd && "bg-primary/10")}
              >
                <div className="mb-1 flex items-center justify-between">
                  <div className="font-bold">
                    {WEEKDAY_NAMES[new Date(`${ymd}T12:00:00`).getDay()]} {dayNum(ymd)}
                    {info?.name && info.kind !== "SHABBAT" && <span className="ms-2 text-sm font-normal text-warning">{info.name}</span>}
                  </div>
                  <button type="button" className="text-sm text-primary" onClick={() => { setSelected(ymd); setNewOpen(true); }}>
                    +
                  </button>
                </div>
                {list.length === 0 ? <div className="text-sm text-muted-foreground">—</div> : <div className="flex flex-col gap-1">{list.map((t) => pill(t))}</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* פרטי משימה */}
      <Sheet open={Boolean(openTask)} onClose={() => setOpenTask(null)} title={openTask?.leadTitle ?? openTask?.title}>
        {openTask && (
          <div className="flex flex-col gap-3">
            <div className="text-sm text-muted-foreground">
              {actionEmoji(openTask.type)} {ACTION_META[(openTask.type ?? "VISIT") as ActionType]?.label} · {ymdOf(openTask.dueAt).split("-").reverse().join(".")}
              {!openTask.allDay && ` ${hmOf(openTask.dueAt)}`}
              {openTask.isApproximate && " · משוער"}
              {openTask.done && " · בוצע"}
            </div>
            {openTask.leadTitle && <div className="font-medium">{openTask.title}</div>}
            {openTask.leadArea && <div className="text-sm">📍 {openTask.leadArea}</div>}
            {openTask.notes && <p className="whitespace-pre-wrap text-sm">{openTask.notes}</p>}
            <div className="flex flex-wrap gap-2">
              {openTask.leadId && (
                <LinkButton href={`/leads/${openTask.leadId}`} variant="outline">
                  לכרטיס הליד
                </LinkButton>
              )}
              {!openTask.done && (
                <>
                  <Button variant="success" onClick={() => { setDoneTask(toSheet(openTask)); setOpenTask(null); }}>
                    ✓ בוצע
                  </Button>
                  <Button variant="outline" onClick={() => { setPostponeTask(toSheet(openTask)); setOpenTask(null); }}>
                    דחה / הזז
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                className="text-danger"
                onClick={async () => {
                  if (!window.confirm("למחוק את המשימה?")) return;
                  try {
                    await api(`/api/tasks/${openTask.id}`, { method: "DELETE" });
                    setOpenTask(null);
                    router.refresh();
                  } catch (e) {
                    toast(errorMessage(e), "error");
                  }
                }}
              >
                מחק
              </Button>
            </div>
          </div>
        )}
      </Sheet>

      <TaskDoneSheet task={doneTask} open={Boolean(doneTask)} onClose={() => setDoneTask(null)} onDone={() => { setDoneTask(null); router.refresh(); }} />
      <PostponeSheet task={postponeTask} open={Boolean(postponeTask)} onClose={() => setPostponeTask(null)} onDone={() => { setPostponeTask(null); router.refresh(); }} />
      <NewTaskSheet open={newOpen} onClose={() => setNewOpen(false)} defaultDate={selected} />
    </div>
  );
}

function shiftMonth(ymd: string, delta: number): string {
  const [y, m] = ymd.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1, 12);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function NewTaskSheet({ open, onClose, defaultDate }: { open: boolean; onClose: () => void; defaultDate: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("");
  const [type, setType] = useState<ActionType | "">("");
  const [notes, setNotes] = useState("");
  const [remind, setRemind] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!title.trim() || !date) return;
    setBusy(true);
    try {
      await api("/api/tasks", {
        method: "POST",
        body: {
          title: title.trim(),
          dueAt: fromZonedTime(`${date}T${time || "00:00"}:00`, TZ).toISOString(),
          allDay: !time,
          type: type || null,
          notes: notes.trim() || null,
          remindMinutesBefore: remind ? Number(remind) : null,
        },
      });
      toast("המשימה נוספה", "success");
      setTitle("");
      setNotes("");
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
      title="משימה חדשה"
      footer={
        <Button size="lg" className="w-full" onClick={save} disabled={busy || !title.trim()}>
          {busy ? "שומר…" : "הוסף"}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="מה לעשות" autoFocus />
        <div className="grid grid-cols-2 gap-2">
          <Field label="תאריך">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="שעה" hint="לא חובה">
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {ACTION_TYPES.map((t) => (
            <Chip key={t} active={type === t} onClick={() => setType(type === t ? "" : t)}>
              {ACTION_META[t].emoji} {ACTION_META[t].label}
            </Chip>
          ))}
        </div>
        <Field label="התראה לפני">
          <Select value={remind} onChange={(e) => setRemind(e.target.value)}>
            <option value="">בלי התראה ייעודית</option>
            <option value="0">בזמן</option>
            <option value="15">15 דקות</option>
            <option value="30">30 דקות</option>
            <option value="60">שעה</option>
            <option value="1440">יום</option>
          </Select>
        </Field>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="הערות" className="min-h-16" />
      </div>
    </Sheet>
  );
}
