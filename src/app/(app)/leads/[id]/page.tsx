import Link from "next/link";
import { notFound } from "next/navigation";
import { getLeadFull } from "@/lib/leads";
import { agoLabel, formatIL, hmIL, relativeDayLabel, shortDateTime } from "@/lib/dates";
import { hebrewDateLabel, checkDateConflict } from "@/lib/hebrew-dates";
import { ACTION_META, actionEmoji, statusLabel, TIME_OF_DAY_META, type ActionType, type TimeOfDay } from "@/lib/categories";
import { displayPhone } from "@/lib/phone";
import { leadTitle, cn } from "@/lib/utils";
import { Card, SectionTitle } from "@/components/ui/card";
import { ActionIcon, HeatBadge, NoPhoneTag, StatusBadge } from "@/components/ui/domain";
import { TaskList } from "@/components/tasks/task-list";
import { DeleteLeadButton, DeletePhotoButton, LeadCardActions, PhotoUploader } from "@/components/leads/lead-card-actions";

export const dynamic = "force-dynamic";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lead = await getLeadFull(id);
  if (!lead) notFound();
  const now = new Date();
  const openTasks = lead.tasks.filter((t) => !t.done);
  const doneTasks = lead.tasks.filter((t) => t.done).slice(0, 5);
  const tasksWithLead = openTasks.map((t) => ({ ...t, lead }));
  const overdue = lead.nextActionAt && lead.nextActionAt < now;
  const conflict = lead.nextActionAt && lead.nextActionAt >= now ? checkDateConflict(lead.nextActionAt) : null;
  const cardLead = { ...lead, openTasks: openTasks.length };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/leads" className="text-sm text-muted-foreground hover:underline">
          ← כל הלידים
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{leadTitle(lead)}</h1>
          <StatusBadge status={lead.status} />
          <HeatBadge heat={lead.heat} />
          {!lead.phone && <NoPhoneTag />}
        </div>
        {lead.name && lead.descriptor && <div className="text-muted-foreground">{lead.descriptor}</div>}
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {lead.area && <span>📍 {[lead.area, lead.addressNote].filter(Boolean).join(", ")}</span>}
          {lead.category && <span>🏷 {lead.category}</span>}
          {lead.bestTimeOfDay !== "ANY" && <span>🕒 {TIME_OF_DAY_META[lead.bestTimeOfDay as TimeOfDay].label}</span>}
          {lead.contactName && (
            <span>
              👤 {lead.contactName}
              {lead.contactRole ? ` (${lead.contactRole})` : ""}
            </span>
          )}
          {lead.phone && <span dir="ltr">📞 {displayPhone(lead.phone)}</span>}
          {lead.email && <span dir="ltr">✉️ {lead.email}</span>}
          {lead.website && (
            <a href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`} target="_blank" rel="noopener" className="underline" dir="ltr">
              🌐 {lead.website}
            </a>
          )}
        </div>
      </div>

      <LeadCardActions lead={cardLead} />

      {/* הפעולה הבאה */}
      <Card className={cn("border-2", overdue ? "border-danger/60 bg-danger/5" : lead.nextActionAt ? "border-primary/40" : "border-dashed")}>
        <div className="text-xs font-medium uppercase text-muted-foreground">הפעולה הבאה</div>
        {lead.nextActionAt ? (
          <div className="mt-1 flex items-start gap-3">
            <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-full", overdue ? "bg-danger/10 text-danger" : "bg-primary/10 text-primary")}>
              <ActionIcon type={lead.nextActionType} className="h-6 w-6" />
            </div>
            <div>
              <div className={cn("text-lg font-bold", overdue && "text-danger", lead.nextActionIsApproximate && "approx")}>
                {ACTION_META[(lead.nextActionType ?? "VISIT") as ActionType].verb} · {relativeDayLabel(lead.nextActionAt, now)}
                {hmIL(lead.nextActionAt) !== "00:00" && ` ${hmIL(lead.nextActionAt)}`}
              </div>
              <div className="text-sm text-muted-foreground">
                {shortDateTime(lead.nextActionAt)} · {hebrewDateLabel(lead.nextActionAt)}
                {lead.nextActionIsApproximate && " · תאריך משוער"}
              </div>
              {lead.nextActionNote && <div className="mt-1">{lead.nextActionNote}</div>}
              {conflict && <div className={cn("mt-1 text-sm", conflict.level === "block" ? "text-danger" : "text-warning")}>⚠️ {conflict.message}</div>}
            </div>
          </div>
        ) : (
          <div className="mt-1 text-muted-foreground">אין מעקב קבוע — ליד בלי פעולה הבאה נשכח. לחץ &quot;קבע מעקב&quot;.</div>
        )}
      </Card>

      {/* מה ראיתי */}
      <Card className="bg-amber-50/60 dark:bg-amber-900/10">
        <div className="flex items-center justify-between">
          <div className="font-bold">👁 מה ראיתי</div>
          <Link href={`/leads/${lead.id}/edit`} className="text-sm text-primary underline">
            ערוך
          </Link>
        </div>
        {lead.observation ? <p className="mt-1 whitespace-pre-wrap text-lg leading-relaxed">{lead.observation}</p> : <p className="mt-1 text-muted-foreground">עדיין לא נרשם. זה הנכס הכי שווה בכרטיס — ניירת, תור, לוח מחיק, כמה עובדים.</p>}
      </Card>

      {(lead.painPoints || lead.currentTools) && (
        <Card className="grid gap-3 sm:grid-cols-2">
          {lead.painPoints && (
            <div>
              <div className="font-bold">כאבים</div>
              <p className="whitespace-pre-wrap">{lead.painPoints}</p>
            </div>
          )}
          {lead.currentTools && (
            <div>
              <div className="font-bold">במה עובדים היום</div>
              <p>{lead.currentTools}</p>
            </div>
          )}
        </Card>
      )}

      {openTasks.length > 0 && (
        <div>
          <SectionTitle count={openTasks.length} className="mt-0">
            משימות פתוחות
          </SectionTitle>
          <TaskList tasks={tasksWithLead} variant={overdue ? "overdue" : "today"} />
        </div>
      )}

      <div>
        <SectionTitle count={lead.touches.length} className="mt-0">
          ציר זמן מגעים
        </SectionTitle>
        {lead.touches.length === 0 ? (
          <p className="text-sm text-muted-foreground">אין מגעים עדיין.</p>
        ) : (
          <ol className="relative flex flex-col gap-3 border-s-2 border-border ps-4">
            {lead.touches.map((t) => (
              <li key={t.id} className="relative">
                <span className="absolute -start-[1.45rem] top-1 flex h-6 w-6 items-center justify-center rounded-full bg-card text-xs ring-2 ring-border">{actionEmoji(t.type)}</span>
                <div className="text-sm text-muted-foreground">
                  {formatIL(t.at, "EEEE d.M.yyyy")} {hmIL(t.at) !== "00:00" && hmIL(t.at)} · {agoLabel(t.at, now)}
                  {t.withWhom && ` · עם ${t.withWhom}`}
                  {t.durationMin != null && ` · ${t.durationMin} דק׳`}
                </div>
                <div className="whitespace-pre-wrap">{t.summary}</div>
                {t.outcome && <div className="text-sm">סוכם: {t.outcome}</div>}
              </li>
            ))}
          </ol>
        )}
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

      {lead.notes && (
        <Card>
          <div className="font-bold">הערות</div>
          <p className="whitespace-pre-wrap">{lead.notes}</p>
        </Card>
      )}

      {(doneTasks.length > 0 || lead.statusHistory.length > 1) && (
        <details className="rounded-2xl border border-border bg-card p-3 text-sm">
          <summary className="cursor-pointer font-medium">היסטוריה</summary>
          {lead.statusHistory.length > 0 && (
            <ul className="mt-2 text-muted-foreground">
              {lead.statusHistory.map((h) => (
                <li key={h.id}>
                  {formatIL(h.at, "d.M.yyyy")}: {h.from ? `${statusLabel(h.from)} → ` : ""}
                  {statusLabel(h.to)}
                </li>
              ))}
            </ul>
          )}
          {doneTasks.length > 0 && (
            <ul className="mt-2">
              {doneTasks.map((t) => (
                <li key={t.id} className="text-muted-foreground">
                  ✓ {t.title} — {t.doneAt ? formatIL(t.doneAt, "d.M.yyyy") : ""}
                  {t.outcome ? ` · ${t.outcome}` : ""}
                </li>
              ))}
            </ul>
          )}
        </details>
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          נראה לראשונה {formatIL(lead.firstSeenAt, "d.M.yyyy")} · מגע אחרון {agoLabel(lead.lastTouchAt, now)}
        </span>
        <DeleteLeadButton leadId={lead.id} />
      </div>
    </div>
  );
}
