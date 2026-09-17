"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, Clock } from "lucide-react";
import type { TaskWithLead } from "@/lib/leads";
import { hmIL } from "@/lib/dates";
import { leadTitle } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { ActionIcon, HeatBadge, NoPhoneTag } from "@/components/ui/domain";
import { PostponeSheet, TaskDoneSheet, type SheetTask } from "./task-sheets";

const THRESHOLD = 80;

function TaskRow({ task, variant, onDone, onPostpone, onOpen }: { task: TaskWithLead; variant: "overdue" | "today" | "week"; onDone: () => void; onPostpone: () => void; onOpen: () => void }) {
  const [dx, setDx] = useState(0);
  const [anim, setAnim] = useState(false);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const axis = useRef<"x" | "y" | null>(null);

  function down(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    axis.current = null;
    setAnim(false);
  }
  function move(e: React.PointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    const ddx = e.clientX - start.current.x;
    const ddy = e.clientY - start.current.y;
    if (!axis.current) {
      if (Math.abs(ddx) < 6 && Math.abs(ddy) < 6) return;
      axis.current = Math.abs(ddx) > Math.abs(ddy) ? "x" : "y";
      if (axis.current === "x") e.currentTarget.setPointerCapture(start.current.id);
    }
    if (axis.current === "x") setDx(Math.max(-150, Math.min(150, ddx)));
  }
  function up() {
    if (!start.current) return;
    const moved = axis.current === "x";
    start.current = null;
    setAnim(true);
    if (moved && dx > THRESHOLD) onDone();
    else if (moved && dx < -THRESHOLD) onPostpone();
    else if (!moved) onOpen();
    setDx(0);
    axis.current = null;
  }
  function cancel() {
    start.current = null;
    axis.current = null;
    setAnim(true);
    setDx(0);
  }

  const lead = task.lead;
  const title = lead ? leadTitle(lead) : task.title;
  const sub = lead && task.title.includes(title) ? task.notes : task.title !== title ? task.title : task.notes;

  return (
    <div className="relative overflow-hidden rounded-2xl">
      <div className={cn("absolute inset-y-0 start-0 flex w-1/2 items-center justify-start bg-success px-4 text-white transition-opacity", dx > 10 ? "opacity-100" : "opacity-0")}>
        <Check className="h-6 w-6" />
        <span className="ms-2 font-medium">בוצע</span>
      </div>
      <div className={cn("absolute inset-y-0 end-0 flex w-1/2 items-center justify-end bg-warning px-4 text-white transition-opacity", dx < -10 ? "opacity-100" : "opacity-0")}>
        <span className="me-2 font-medium">דחה</span>
        <Clock className="h-6 w-6" />
      </div>
      <div
        role="button"
        tabIndex={0}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancel}
        onKeyDown={(e) => e.key === "Enter" && onOpen()}
        style={{ transform: `translateX(${dx}px)`, transition: anim ? "transform 180ms ease-out" : undefined, touchAction: "pan-y" }}
        className={cn(
          "relative flex min-h-[64px] cursor-pointer select-none items-center gap-3 border bg-card px-3 py-2 shadow-sm",
          "rounded-2xl",
          variant === "overdue" ? "border-danger/40" : "border-border",
        )}
      >
        <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full", variant === "overdue" ? "bg-danger/10 text-danger" : "bg-primary/10 text-primary")}>
          <ActionIcon type={task.type} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn("truncate font-semibold", task.isApproximate && "approx")}>{title}</span>
            {!task.allDay && <span className="shrink-0 rounded-md bg-muted px-1.5 text-xs">{hmIL(task.dueAt)}</span>}
            {lead && <HeatBadge heat={lead.heat} short className="shrink-0 px-1.5" />}
          </div>
          <div className="truncate text-sm text-muted-foreground">
            {lead?.area && <span>{lead.area}</span>}
            {lead?.area && sub && <span> · </span>}
            {sub && <span>{sub}</span>}
          </div>
          {lead && !lead.phone && <NoPhoneTag className="mt-1" />}
        </div>
        <div className="hidden shrink-0 items-center gap-1 md:flex">
          <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onDone(); }} className="flex h-10 w-10 items-center justify-center rounded-full text-success hover:bg-success/10" aria-label="בוצע">
            <Check className="h-5 w-5" />
          </button>
          <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onPostpone(); }} className="flex h-10 w-10 items-center justify-center rounded-full text-warning hover:bg-warning/10" aria-label="דחה">
            <Clock className="h-5 w-5" />
          </button>
        </div>
        <ChevronLeft className="h-5 w-5 shrink-0 text-muted-foreground md:hidden" />
      </div>
    </div>
  );
}

export function TaskList({ tasks, variant }: { tasks: TaskWithLead[]; variant: "overdue" | "today" | "week" }) {
  const router = useRouter();
  const [doneTask, setDoneTask] = useState<SheetTask | null>(null);
  const [postponeTask, setPostponeTask] = useState<SheetTask | null>(null);

  const toSheet = (t: TaskWithLead): SheetTask => ({ id: t.id, title: t.lead ? leadTitle(t.lead) : t.title, type: t.type, leadId: t.leadId, lead: t.lead ? { phone: t.lead.phone, status: t.lead.status, heat: t.lead.heat } : null });

  return (
    <div className="flex flex-col gap-2">
      {tasks.map((t) => (
        <TaskRow
          key={t.id}
          task={t}
          variant={variant}
          onDone={() => setDoneTask(toSheet(t))}
          onPostpone={() => setPostponeTask(toSheet(t))}
          onOpen={() => router.push(t.leadId ? `/leads/${t.leadId}` : `/calendar?task=${t.id}`)}
        />
      ))}
      <TaskDoneSheet task={doneTask} open={Boolean(doneTask)} onClose={() => setDoneTask(null)} onDone={() => { setDoneTask(null); router.refresh(); }} />
      <PostponeSheet task={postponeTask} open={Boolean(postponeTask)} onClose={() => setPostponeTask(null)} onDone={() => { setPostponeTask(null); router.refresh(); }} />
    </div>
  );
}
