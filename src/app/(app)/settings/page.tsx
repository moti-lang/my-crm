import { prisma } from "@/lib/db";
import { pushConfigured } from "@/lib/push";
import { whatsappConfigured } from "@/lib/whatsapp";
import { claudeConfigured } from "@/lib/parse";
import { isAuthDisabled } from "@/lib/auth";
import { appUrl, getOrCreateIcsToken } from "@/lib/settings";
import { Card, PageTitle } from "@/components/ui/card";
import { Appearance, FailedQueuePanel, IcsControls, InstallHelp, JobsPanel, LogoutButton, PushControls, SnapshotsPanel } from "./settings-client";
import { ImportPanel } from "./import-panel";
import { CalendarPanel } from "./calendar-panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "הגדרות" };

export default async function SettingsPage() {
  const [subs, leads, openTasks, snapshots, icsToken] = await Promise.all([
    prisma.pushSubscription.count(),
    prisma.lead.count(),
    prisma.task.count({ where: { done: false } }),
    prisma.snapshot.findMany({ select: { id: true, createdAt: true, leadCount: true }, orderBy: { createdAt: "desc" }, take: 30 }),
    getOrCreateIcsToken(),
  ]);
  const icsUrl = appUrl(`/api/calendar.ics?token=${icsToken}`);
  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <Card className="flex flex-col gap-2">
      <div className="font-bold">{title}</div>
      {children}
    </Card>
  );

  return (
    <div className="flex flex-col gap-3">
      <PageTitle sub={`${leads} לידים · ${openTasks} משימות פתוחות`}>הגדרות</PageTitle>
      <Section title="📲 התקנה למסך הבית">
        <InstallHelp />
      </Section>
      <Section title="🔔 התראות (Web Push)">
        <PushControls configured={pushConfigured()} publicKey={process.env.VAPID_PUBLIC_KEY ?? null} subscriptions={subs} />
        <p className="text-xs text-muted-foreground">
          לוח זמנים: דיגסט בוקר (07:30–08:30) · סיכום יום (19:30–20:30) · ראשון בבוקר סיכום שבועי · תזכורות למשימות בכל הרצה (כל 15 דק׳ עם cron-job.org / Vercel Pro). ב-iOS ההתראות עובדות רק כשהאפליקציה מותקנת למסך הבית.
        </p>
      </Section>
      <Section title="🕯 שבת וחג — חסימת התראות">
        <CalendarPanel />
      </Section>
      <Section title="💬 ערוץ גיבוי — וואטסאפ">
        <p className="text-sm">{whatsappConfigured() ? "✓ מוגדר (Green API). הדיגסט של הבוקר וסיכום היום נשלחים גם לוואטסאפ." : "לא מוגדר. הגדר GREEN_API_ID_INSTANCE, GREEN_API_TOKEN ו-WHATSAPP_TO כדי לקבל את הדיגסט גם בוואטסאפ."}</p>
      </Section>
      <Section title="✨ פירוק טקסט חופשי (Claude)">
        <p className="text-sm">{claudeConfigured() ? `✓ מוגדר (${process.env.CLAUDE_MODEL || "claude-sonnet-5"}).` : "לא מוגדר (ANTHROPIC_API_KEY). ההוספה המהירה עובדת עם מפרש מקומי בסיסי."}</p>
      </Section>
      <Section title="📅 יומן (ICS)">
        <IcsControls url={icsUrl} webcal={icsUrl.replace(/^https?:/, "webcal:")} />
      </Section>
      <Section title="📥 ייבוא לידים מקובץ">
        <ImportPanel />
      </Section>
      <Section title="💾 ייצוא וגיבוי">
        <SnapshotsPanel snapshots={snapshots.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() }))} />
      </Section>
      <Section title="⚙️ הרצה ידנית של עבודות רקע">
        <JobsPanel />
      </Section>
      <FailedQueuePanel />
      <Section title="🎨 מראה">
        <Appearance />
      </Section>
      <Section title="🔐 חשבון">
        {isAuthDisabled() ? <p className="text-sm text-muted-foreground">מסך הכניסה כבוי (AUTH_DISABLED).</p> : <LogoutButton />}
      </Section>
    </div>
  );
}
