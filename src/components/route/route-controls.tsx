"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LocateFixed, Route } from "lucide-react";
import { Button, LinkButton } from "@/components/ui/button";
import { Chip } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";

export function RouteControls({ areas }: { areas: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [locating, setLocating] = useState(false);
  const area = sp.get("area") ?? "";
  const lat = sp.get("lat");
  const r = sp.get("r") ?? "1.5";
  const closed = sp.get("closed") === "1";

  function push(next: Record<string, string | null>) {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "") q.delete(k);
      else q.set(k, v);
    }
    router.push(`${pathname}?${q.toString()}`);
  }

  function locate() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        push({ lat: pos.coords.latitude.toFixed(5), lng: pos.coords.longitude.toFixed(5), r, area: null });
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Select value={area} onChange={(e) => push({ area: e.target.value, lat: null, lng: null })} className="flex-1">
          <option value="">כל האזורים</option>
          {areas.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
        <Button variant={lat ? "primary" : "outline"} onClick={locate} disabled={locating}>
          <LocateFixed className={locating ? "h-5 w-5 animate-pulse" : "h-5 w-5"} />
          {locating ? "מאתר…" : "אני כאן עכשיו"}
        </Button>
      </div>
      <div className="no-scrollbar flex items-center gap-2 overflow-x-auto">
        {lat && (
          <>
            <span className="text-sm text-muted-foreground">רדיוס:</span>
            {["0.5", "1", "1.5", "3", "5"].map((k) => (
              <Chip key={k} active={r === k} onClick={() => push({ r: k })}>
                {k} ק״מ
              </Chip>
            ))}
            <Chip onClick={() => push({ lat: null, lng: null, r: null })}>✕ בטל</Chip>
          </>
        )}
        <Chip active={closed} onClick={() => push({ closed: closed ? null : "1" })}>
          כולל סגורים
        </Chip>
        <LinkButton href={`/route/plan${area ? `?area=${encodeURIComponent(area)}` : ""}`} variant="secondary" size="sm" className="ms-auto">
          <Route className="h-4 w-4" /> בנה לי סבב
        </LinkButton>
      </div>
    </div>
  );
}
