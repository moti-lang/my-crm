import Link from "next/link";
import { prisma } from "@/lib/db";
import { buildRoutePlan, stopTitle, type PlanStop } from "@/lib/route-plan";
import { addDaysIL, dateAtIL, ymdIL } from "@/lib/dates";
import { Card, EmptyState, PageTitle, SectionTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { HeatBadge, NoPhoneTag, StatusBadge } from "@/components/ui/domain";
import { NavButtons } from "@/components/leads/lead-actions";
import { SawClosedButton } from "@/components/route/saw-closed-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "בנה לי סבב" };

function Stops({ stops, offset }: { stops: PlanStop[]; offset: number }) {
  return (
    <ol className="flex flex-col gap-2">
      {stops.map((s, i) => (
        <li key={s.lead.id} className="rounded-2xl border border-border bg-card p-3">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">{offset + i + 1}</div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/leads/${s.lead.id}`} className="font-semibold">
                  {stopTitle(s)}
                </Link>
                <StatusBadge status={s.lead.status} />
                <HeatBadge heat={s.lead.heat} short />
                {!s.lead.phone && <NoPhoneTag />}
              </div>
              <div className="text-sm text-muted-foreground">
                {[s.lead.area, s.lead.addressNote, s.lead.category].filter(Boolean).join(" · ")} · <span className={s.overdue ? "text-danger" : ""}>{s.reason}</span>
              </div>
              <dl className="mt-2 grid gap-1 text-sm">
                {s.promised && (
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-muted-foreground">הבטיחו</dt>
                    <dd>{s.promised}</dd>
                  </div>
                )}
                {s.lastSeen && (
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-muted-foreground">פעם קודמת</dt>
                    <dd>{s.lastSeen}</dd>
                  </div>
                )}
                {s.lead.observation && (
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-muted-foreground">ראיתי</dt>
                    <dd>{s.lead.observation}</dd>
                  </div>
                )}
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-muted-foreground">פתיחה</dt>
                  <dd className="italic">„{s.opener}”</dd>
                </div>
              </dl>
              <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto">
                <NavButtons target={s.lead} size="sm" />
                <SawClosedButton leadId={s.lead.id} />
              </div>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default async function PlanPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const now = new Date();
  const areas = (await prisma.lead.findMany({ where: { area: { not: null } }, distinct: ["area"], select: { area: true }, orderBy: { area: "asc" } })).map((a) => a.area!);
  const from = sp.from || ymdIL(now);
  const to = sp.to || ymdIL(addDaysIL(now, 7));
  const hours = Math.min(12, Math.max(1, Number(sp.hours) || 4));
  const area = sp.area || null;
  const run = sp.run === "1";
  const plan = run ? await buildRoutePlan({ area, from: dateAtIL(from), to: dateAtIL(to), hours }, now) : null;
  const total = plan ? plan.morning.length + plan.afternoon.length + plan.any.length : 0;

  return (
    <div>
      <PageTitle sub="לידים שדורשים כניסה, מקובצים לפי שעות ורחוב">בנה לי סבב</PageTitle>
      <Card>
        <form method="GET" className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <input type="hidden" name="run" value="1" />
          <Field label="אזור" className="col-span-2 md:col-span-2">
            <Select name="area" defaultValue={area ?? ""}>
              <option value="">הכל</option>
              {areas.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="מתאריך">
            <Input type="date" name="from" defaultValue={from} />
          </Field>
          <Field label="עד תאריך">
            <Input type="date" name="to" defaultValue={to} />
          </Field>
          <Field label="כמה שעות יש לי">
            <Input type="number" name="hours" min={1} max={12} step={0.5} defaultValue={hours} inputMode="decimal" />
          </Field>
          <div className="col-span-2 md:col-span-5">
            <Button type="submit" size="lg" className="w-full">
              🚶 בנה סבב
            </Button>
          </div>
        </form>
      </Card>

      {plan && (
        <>
          <p className="mt-3 text-sm text-muted-foreground">
            {plan.candidates} לידים מתאימים · עד {plan.maxStops} עצירות ב-{hours} שעות (~{plan.minutesPerStop} דק׳ לעצירה)
            {plan.candidates > plan.maxStops ? ` · ${plan.candidates - plan.maxStops} נשארו לסבב הבא` : ""}
          </p>
          {total === 0 && <EmptyState icon="✅" title="אין לידים שדורשים כניסה בטווח הזה" hint="נסה טווח תאריכים רחב יותר או אזור אחר" />}
          {plan.morning.length > 0 && (
            <>
              <SectionTitle count={plan.morning.length}>🌅 סבב בוקר (8:00–13:00) — תעשייה ובתי מלאכה</SectionTitle>
              <Stops stops={plan.morning} offset={0} />
            </>
          )}
          {plan.afternoon.length > 0 && (
            <>
              <SectionTitle count={plan.afternoon.length}>🌇 סבב אחר הצהריים (16:00–20:00) — קמעונאות</SectionTitle>
              <Stops stops={plan.afternoon} offset={plan.morning.length} />
            </>
          )}
          {plan.any.length > 0 && (
            <>
              <SectionTitle count={plan.any.length} tone="muted">
                🕒 כל שעה
              </SectionTitle>
              <Stops stops={plan.any} offset={plan.morning.length + plan.afternoon.length} />
            </>
          )}
        </>
      )}
    </div>
  );
}
