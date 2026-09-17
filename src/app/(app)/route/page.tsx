import { Suspense } from "react";
import { getRouteLeads } from "@/lib/leads";
import { EmptyState, PageTitle, SectionTitle } from "@/components/ui/card";
import { RouteControls } from "@/components/route/route-controls";
import { RouteCard } from "@/components/route/route-card";

export const dynamic = "force-dynamic";
export const metadata = { title: "סבב שטח" };

export default async function RoutePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const now = new Date();
  const lat = sp.lat ? Number(sp.lat) : null;
  const lng = sp.lng ? Number(sp.lng) : null;
  const groups = await getRouteLeads(
    { area: sp.area || null, lat: Number.isFinite(lat) ? lat : null, lng: Number.isFinite(lng) ? lng : null, radiusKm: sp.r ? Number(sp.r) : 1.5, includeClosed: sp.closed === "1" },
    now,
  );
  const total = groups.waiting.length + groups.upcoming.length + groups.rest.length;
  const where = sp.lat ? "ברדיוס ממיקומי" : sp.area ? `ב${sp.area}` : "בכל האזורים";

  return (
    <div>
      <PageTitle sub={`${total} לידים ${where}`}>סבב שטח</PageTitle>
      <Suspense>
        <RouteControls areas={groups.areas} />
      </Suspense>
      {total === 0 && <EmptyState icon="🗺" title="אין לידים כאן" hint={sp.lat ? "נסה רדיוס גדול יותר, או שאין לידים עם מיקום GPS באזור" : "הוסף לידים עם אזור כדי לראות אותם בסבב"} />}

      {groups.waiting.length > 0 && (
        <>
          <SectionTitle tone="danger" count={groups.waiting.length}>
            מחכים לי
          </SectionTitle>
          <div className="flex flex-col gap-2">
            {groups.waiting.map((l) => (
              <RouteCard key={l.id} lead={l} now={now} />
            ))}
          </div>
        </>
      )}
      {groups.upcoming.length > 0 && (
        <>
          <SectionTitle count={groups.upcoming.length}>קרובים (השבוע)</SectionTitle>
          <div className="flex flex-col gap-2">
            {groups.upcoming.map((l) => (
              <RouteCard key={l.id} lead={l} now={now} />
            ))}
          </div>
        </>
      )}
      {groups.rest.length > 0 && (
        <>
          <SectionTitle tone="muted" count={groups.rest.length}>
            כל השאר באזור
          </SectionTitle>
          <div className="flex flex-col gap-2">
            {groups.rest.map((l) => (
              <RouteCard key={l.id} lead={l} now={now} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
