"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, Search } from "lucide-react";
import { HEATS, HEAT_META, LEAD_STATUSES, STATUS_META } from "@/lib/categories";
import { Chip } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { AnchorButton } from "@/components/ui/button";

export function LeadFilters({ areas, categories, count }: { areas: string[]; categories: string[]; count: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");

  function push(next: Record<string, string | null>) {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "") params.delete(k);
      else params.set(k, v);
    }
    router.replace(`${pathname}?${params.toString()}`);
  }

  useEffect(() => {
    const t = setTimeout(() => {
      if ((sp.get("q") ?? "") !== q) push({ q });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const get = (k: string) => sp.get(k) ?? "";
  const toggle = (k: string, v: string) => push({ [k]: get(k) === v ? null : v });

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute end-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש חופשי: שם, אזור, איש קשר, מה ראיתי…" className="pe-10" />
      </div>
      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        <Chip active={get("due") === "overdue"} onClick={() => toggle("due", "overdue")}>
          🔴 באיחור
        </Chip>
        <Chip active={get("due") === "today"} onClick={() => toggle("due", "today")}>
          היום
        </Chip>
        <Chip active={get("due") === "week"} onClick={() => toggle("due", "week")}>
          השבוע
        </Chip>
        <Chip active={get("phone") === "no"} onClick={() => toggle("phone", "no")}>
          בלי טלפון
        </Chip>
        <Chip active={get("stuck") === "1"} onClick={() => toggle("stuck", "1")}>
          ⏸ תקועים
        </Chip>
        <Chip active={get("status") === "active"} onClick={() => toggle("status", "active")}>
          פעילים
        </Chip>
        <Chip active={get("heat") === "HOT"} onClick={() => toggle("heat", "HOT")}>
          🔥 חמים
        </Chip>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
        <Select value={get("area")} onChange={(e) => push({ area: e.target.value })}>
          <option value="">כל האזורים</option>
          {areas.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
        <Select value={get("status")} onChange={(e) => push({ status: e.target.value })}>
          <option value="">כל הסטטוסים</option>
          <option value="active">פעילים</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
            </option>
          ))}
        </Select>
        <Select value={get("heat")} onChange={(e) => push({ heat: e.target.value })}>
          <option value="">כל החום</option>
          {HEATS.map((h) => (
            <option key={h} value={h}>
              {HEAT_META[h].emoji} {HEAT_META[h].label}
            </option>
          ))}
        </Select>
        <Select value={get("category")} onChange={(e) => push({ category: e.target.value })}>
          <option value="">כל התחומים</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Select value={get("due")} onChange={(e) => push({ due: e.target.value })}>
          <option value="">תאריך מעקב: הכל</option>
          <option value="overdue">באיחור</option>
          <option value="today">היום</option>
          <option value="week">השבוע</option>
          <option value="any">יש מעקב</option>
          <option value="none">בלי מעקב</option>
        </Select>
        <Select value={get("sort")} onChange={(e) => push({ sort: e.target.value })}>
          <option value="">מיון: מעקב הקרוב</option>
          <option value="recent">עודכן לאחרונה</option>
          <option value="created">נוצר לאחרונה</option>
          <option value="touch">מגע ישן ביותר</option>
          <option value="name">שם</option>
        </Select>
      </div>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{count} לידים</span>
        <div className="flex gap-2">
          {sp.toString() && (
            <button type="button" className="underline" onClick={() => { setQ(""); router.replace(pathname); }}>
              נקה סינון
            </button>
          )}
          <AnchorButton href="/api/export/csv" variant="ghost" size="sm">
            <Download className="h-4 w-4" /> CSV
          </AnchorButton>
        </div>
      </div>
    </div>
  );
}
