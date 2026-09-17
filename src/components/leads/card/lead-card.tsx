"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import type { LeadFull } from "@/lib/leads";
import { HEATS, HEAT_META, LEAD_STATUSES, STATUS_META, TIMES_OF_DAY, TIME_OF_DAY_META, ACTION_META, type ActionType, type LeadStatus, type TimeOfDay } from "@/lib/categories";
import { agoLabel, formatIL, hmIL, relativeDayLabel, shortDateTime } from "@/lib/dates";
import { displayPhone } from "@/lib/phone";
import { leadTitle, cn } from "@/lib/utils";
import { useAutosave } from "@/lib/client/use-autosave";
import { instantToNext, nextToIso, type NextActionValue } from "@/lib/client/lead-form-model";
import { Card, SectionTitle } from "@/components/ui/card";
import { Chip } from "@/components/ui/badge";
import { ActionIcon, NoPhoneTag } from "@/components/ui/domain";
import { NextActionPicker } from "@/components/leads/next-action-picker";
import { LeadCardActions, DeleteLeadButton, DeletePhotoButton, PhotoUploader } from "@/components/leads/lead-card-actions";
import { TaskList } from "@/components/tasks/task-list";
import type { TaskWithLead } from "@/lib/leads";
import { InlineSelect, InlineText } from "./inline-field";
import { SaveIndicator } from "./save-indicator";
import { TouchTimeline } from "./touch-timeline";

type TextField = "name" | "descriptor" | "area" | "addressNote" | "category" | "contactName" | "contactRole" | "phone" | "email" | "website" | "observation" | "painPoints" | "currentTools" | "notes";
type Patch = Record<string, unknown>;

export function LeadCard({ lead, openTasks, now, hebrewNext }: { lead: LeadFull; openTasks: TaskWithLead[]; now: Date; hebrewNext: string | null }) {
  const router = useRouter();
  const [overlay, setOverlay] = useState<Partial<Record<TextField, string>>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const nextDirty = useRef(false);
  const [next, setNext] = useState<NextActionValue>(() => instantToNext(lead.nextActionAt, lead.nextActionType, lead.nextActionNote, lead.nextActionIsApproximate));

  const autosave = useAutosave<Patch>({
    path: `/api/leads/${lead.id}`,
    title: `עריכה: ${leadTitle(lead)}`,
    coalesceKey: `lead:${lead.id}`,
    onSaved: (patch) => {
      setOverlay((o) => {
        const n = { ...o };
        for (const k of Object.keys(patch) as TextField[]) if (k in n && (n[k] ?? "") === ((patch[k] as string | null) ?? "")) delete n[k];
        return n;
      });
      if ("nextActionAt" in patch) nextDirty.current = false;
      router.refresh();
    },
  });

  // סנכרון המעקב הבא מהשרת (למשל אחרי סימון משימה כבוצעה) — רק כשאין עריכה שלא נשמרה
  useEffect(() => {
    if (nextDirty.current) return;
    setNext(instantToNext(lead.nextActionAt, lead.nextActionType, lead.nextActionNote, lead.nextActionIsApproximate));
  }, [lead.updatedAt, lead.nextActionAt, lead.nextActionType, lead.nextActionNote, lead.nextActionIsApproximate]);

  const view = useMemo(() => ({ ...lead, ...overlay }), [lead, overlay]);
  const hasPhone = Boolean((view.phone ?? "").trim());
  const overdue = Boolean(lead.nextActionAt && lead.nextActionAt < now);

  const edit = (field: TextField, value: string, immediate = false) => {
    setOverlay((o) => ({ ...o, [field]: value }));
    autosave.save({ [field]: value.trim() ? value : null }, immediate);
  };
  const setField = (field: string, value: string) => autosave.save({ [field]: value }, true);
  const changeNext = (n: NextActionValue) => {
    nextDirty.current = true;
    setNext(n);
    autosave.save({
      nextActionAt: nextToIso(n),
      nextActionType: n.date ? (n.type ?? (hasPhone ? "CALL" : "VISIT")) : null,
      nextActionNote: n.date ? n.note || null : null,
      nextActionIsApproximate: n.date ? n.isApproximate : false,
    });
  };

  const text = (field: TextField, props: Omit<Parameters<typeof InlineText>[0], "value" | "onChange" | "onCommit">) => (
    <InlineText
      value={view[field] ?? ""}
      displayValue={field === "phone" && !(field in overlay) && lead.phone ? displayPhone(lead.phone) : undefined}
      onChange={(v) => edit(field, v)}
      onCommit={(v) => edit(field, v, true)}
      {...props}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <SaveIndicator state={autosave.state} onRetry={autosave.retry} />

      {/* כותרת */}
      <div>
        <div className="flex items-center justify-between">
          <Link href="/leads" className="text-sm text-muted-foreground hover:underline">
            ← כל הלידים
          </Link>
          <div className="relative">
            <button type="button" onClick={() => setMenuOpen((v) => !v)} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-muted" aria-label="עוד פעולות" aria-expanded={menuOpen}>
              <MoreHorizontal className="h-5 w-5" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
                <div className="absolute end-0 z-30 mt-1 w-56 rounded-xl border border-border bg-card p-1 shadow-lg">
                  <Link href={`/leads/${lead.id}/edit`} className="flex min-h-11 items-center rounded-lg px-3 hover:bg-muted">
                    טופס עריכה מלא
                  </Link>
                  <DeleteLeadButton leadId={lead.id} asMenuItem />
                </div>
              </>
            )}
          </div>
        </div>
        {text("name", { placeholder: "שם העסק (לחץ להוספה)", big: true, textClassName: "text-2xl font-bold" })}
        {text("descriptor", { placeholder: "תיאור מזהה — נגריה ליד רחוב הסלע" })}
        <div className="mt-1 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
          {text("area", { icon: "📍", placeholder: "אזור / רחוב" })}
          {text("addressNote", { icon: "🏢", placeholder: "כתובת / הערת מיקום" })}
          {text("category", { icon: "🏷", placeholder: "תחום" })}
          <InlineSelect<TimeOfDay> value={view.bestTimeOfDay as TimeOfDay} onChange={(v) => setField("bestTimeOfDay", v)} options={TIMES_OF_DAY.map((t) => ({ value: t, label: `🕒 ${TIME_OF_DAY_META[t].label}` }))} className="py-1" />
          {text("contactName", { icon: "👤", placeholder: "איש קשר" })}
          {text("contactRole", { icon: "🪪", placeholder: "תפקיד" })}
          {text("phone", { icon: "📞", placeholder: "טלפון (ריק = מסלול כניסה)", type: "tel", ltr: true })}
          {text("email", { icon: "✉️", placeholder: "מייל", type: "email", ltr: true })}
          {text("website", { icon: "🌐", placeholder: "אתר", type: "url", ltr: true })}
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <InlineSelect<LeadStatus> label="סטטוס" value={view.status as LeadStatus} onChange={(v) => setField("status", v)} options={LEAD_STATUSES.map((s) => ({ value: s, label: `${STATUS_META[s].label} — ${STATUS_META[s].hint}` }))} />
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">חום</span>
            <div className="flex gap-2">
              {HEATS.map((h) => (
                <Chip key={h} active={view.heat === h} onClick={() => setField("heat", h)} className="flex-1 justify-center" title={HEAT_META[h].hint}>
                  {HEAT_META[h].emoji} {HEAT_META[h].label}
                </Chip>
              ))}
            </div>
          </div>
        </div>
        {!hasPhone && <NoPhoneTag className="mt-2" />}
      </div>

      <LeadCardActions lead={{ ...lead, openTasks: openTasks.length }} />

      {/* הפעולה הבאה — עריכה ישירה */}
      <Card className={cn("border-2", overdue ? "border-danger/60 bg-danger/5" : lead.nextActionAt ? "border-primary/40" : "border-dashed")}>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-medium uppercase text-muted-foreground">הפעולה הבאה</div>
          {lead.nextActionAt && (
            <div className={cn("flex items-center gap-2 text-sm font-bold", overdue && "text-danger", lead.nextActionIsApproximate && "approx")}>
              <ActionIcon type={lead.nextActionType} className="h-4 w-4" />
              {ACTION_META[(lead.nextActionType ?? "VISIT") as ActionType].verb} · {relativeDayLabel(lead.nextActionAt, now)}
              {hmIL(lead.nextActionAt) !== "00:00" && ` ${hmIL(lead.nextActionAt)}`}
            </div>
          )}
        </div>
        {lead.nextActionAt && (
          <div className="mb-2 text-sm text-muted-foreground">
            {shortDateTime(lead.nextActionAt)}
            {hebrewNext && ` · ${hebrewNext}`}
            {lead.nextActionIsApproximate && " · תאריך משוער"}
          </div>
        )}
        <NextActionPicker value={next} onChange={changeNext} hasPhone={hasPhone} />
        {!lead.nextActionAt && !next.date && <p className="mt-2 text-sm text-muted-foreground">ליד בלי פעולה הבאה נשכח — בחר תאריך.</p>}
      </Card>

      {/* מה ראיתי */}
      <Card className="bg-amber-50/60 dark:bg-amber-900/10">
        <div className="font-bold">👁 מה ראיתי</div>
        {text("observation", { placeholder: "ניירת על השולחן, תור בכניסה, לוח מחיק, כמה עובדים… (לחץ לכתיבה)", multiline: true, big: true })}
      </Card>

      <Card className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="font-bold">כאבים</div>
          {text("painPoints", { placeholder: "מה כואב להם", multiline: true })}
        </div>
        <div>
          <div className="font-bold">במה עובדים היום</div>
          {text("currentTools", { placeholder: "אקסל / מחברת / וואטסאפ / תוכנה", multiline: true })}
        </div>
      </Card>

      {openTasks.length > 0 && (
        <div>
          <SectionTitle count={openTasks.length} className="mt-0">
            משימות פתוחות
          </SectionTitle>
          <TaskList tasks={openTasks} variant={overdue ? "overdue" : "today"} />
        </div>
      )}

      <div>
        <SectionTitle count={lead.touches.length} className="mt-0">
          ציר זמן מגעים
        </SectionTitle>
        <TouchTimeline touches={lead.touches} now={now} leadTitle={leadTitle(lead)} />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle count={lead.photos.length} className="my-0">
            תמונות
          </SectionTitle>
          <PhotoUploader leadId={lead.id} />
        </div>
        {lead.photos.length === 0 ? (
          <p className="text-sm text-muted-foreground">צלם שלט כניסה (רשימת חברות וקומות) או חזית העסק לזיהוי.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {lead.photos.map((p) => (
              <figure key={p.id} className="relative overflow-hidden rounded-xl border border-border">
                <a href={p.url} target="_blank" rel="noopener">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.caption ?? "תמונה"} className="aspect-square w-full object-cover" loading="lazy" />
                </a>
                <DeletePhotoButton photoId={p.id} />
                {p.caption && <figcaption className="px-2 py-1 text-xs">{p.caption}</figcaption>}
              </figure>
            ))}
          </div>
        )}
      </div>

      <Card>
        <div className="font-bold">הערות</div>
        {text("notes", { placeholder: "הערות חופשיות", multiline: true })}
      </Card>

      <div className="text-xs text-muted-foreground">
        נראה לראשונה {formatIL(lead.firstSeenAt, "d.M.yyyy")} · מגע אחרון {agoLabel(lead.lastTouchAt, now)}
        {lead.statusHistory.length > 1 && (
          <details className="mt-1">
            <summary className="cursor-pointer">היסטוריית סטטוסים</summary>
            <ul>
              {lead.statusHistory.map((h) => (
                <li key={h.id}>
                  {formatIL(h.at, "d.M.yyyy")}: {h.from ? `${STATUS_META[h.from as LeadStatus]?.label ?? h.from} → ` : ""}
                  {STATUS_META[h.to as LeadStatus]?.label ?? h.to}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
