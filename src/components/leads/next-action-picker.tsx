"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarX2 } from "lucide-react";
import { ACTION_META, ACTION_TYPES, type ActionType } from "@/lib/categories";
import type { NextActionValue } from "@/lib/client/lead-form-model";
import { Chip } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ActionIcon } from "@/components/ui/domain";
import { cn } from "@/lib/utils";

const QUICK: Array<[string, string]> = [
  ["מחר", "מחר"],
  ["3 ימים", "בעוד 3 ימים"],
  ["שבוע", "בעוד שבוע"],
  ["שבועיים", "בעוד שבועיים"],
  ["חודש", "בעוד חודש"],
  ["אחרי החג", "אחרי החג"],
  ["אחרי החגים", "אחרי החגים"],
];

interface Conflict {
  level: "block" | "warn";
  message: string;
  suggestionYmd: string;
}

export function NextActionPicker({
  value,
  onChange,
  hasPhone,
  compact,
}: {
  value: NextActionValue;
  onChange: (v: NextActionValue) => void;
  hasPhone: boolean;
  compact?: boolean;
}) {
  const [expr, setExpr] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [hebrew, setHebrew] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const effectiveType: ActionType = value.type ?? (hasPhone ? "CALL" : "VISIT");

  useEffect(() => {
    setConflict(null);
    setHebrew(null);
    if (!value.date) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/dates?date=${value.date}`, { signal: ctrl.signal });
        if (!res.ok) return;
        const data = await res.json();
        setConflict(data.conflict ?? null);
        setHebrew(data.hebrew ?? null);
      } catch {}
    }, 250);
    return () => clearTimeout(t);
  }, [value.date]);

  async function resolve(text: string) {
    if (!text.trim()) return;
    setBusy(true);
    setHint(null);
    try {
      const res = await fetch(`/api/dates?expr=${encodeURIComponent(text)}`);
      const data = await res.json();
      if (data.resolved) {
        onChange({ ...value, date: data.resolved.ymd, time: data.resolved.time ?? value.time, isApproximate: data.resolved.isApproximate });
        setHint(data.resolved.note ?? (data.resolved.isApproximate ? "תאריך משוער" : null));
        setExpr("");
      } else {
        setHint(`לא הבנתי את "${text}" — אפשר לבחור תאריך ידנית`);
      }
    } catch {
      setHint("אין חיבור — בחר תאריך ידנית");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* סוג הפעולה */}
      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        {ACTION_TYPES.map((t) => (
          <Chip key={t} active={effectiveType === t} onClick={() => onChange({ ...value, type: t })}>
            <ActionIcon type={t} className="h-4 w-4" />
            {ACTION_META[t].label}
          </Chip>
        ))}
      </div>
      {!hasPhone && effectiveType === "VISIT" && <div className="text-xs text-muted-foreground">אין טלפון — המסלול הוא כניסה פיזית</div>}

      {/* מהיר */}
      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        {QUICK.map(([label, phrase]) => (
          <Chip key={phrase} onClick={() => resolve(phrase)} disabled={busy}>
            {label}
          </Chip>
        ))}
        {value.date && (
          <Chip onClick={() => onChange({ ...value, date: null, time: null, isApproximate: false })} className="text-danger">
            <CalendarX2 className="h-4 w-4" /> בלי מעקב
          </Chip>
        )}
      </div>

      {/* ביטוי חופשי + תאריך */}
      <div className={cn("grid gap-2", compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2")}>
        <Input
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              resolve(expr);
            }
          }}
          onBlur={() => expr && resolve(expr)}
          placeholder='או כתוב: "ביום חמישי", "בין כיפור לסוכות"…'
        />
        <div className="flex gap-2">
          <Input type="date" value={value.date ?? ""} onChange={(e) => onChange({ ...value, date: e.target.value || null })} className={cn("flex-1", value.isApproximate && "approx")} />
          <Input type="time" value={value.time ?? ""} onChange={(e) => onChange({ ...value, time: e.target.value || null })} className="w-28" />
        </div>
      </div>
      {(hint || hebrew) && (
        <div className="text-xs text-muted-foreground">
          {hebrew && <span>{hebrew}</span>}
          {hint && <span className="ms-2">· {hint}</span>}
        </div>
      )}
      {conflict && (
        <div className={cn("flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm", conflict.level === "block" ? "bg-danger/10 text-danger" : "bg-warning/10 text-warning")}>
          <span>⚠️ {conflict.message}</span>
          <button type="button" className="font-medium underline" onClick={() => onChange({ ...value, date: conflict.suggestionYmd })}>
            עבור ל-{conflict.suggestionYmd.split("-").reverse().slice(0, 2).join(".")}
          </button>
        </div>
      )}
      {value.date && (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="h-5 w-5" checked={value.isApproximate} onChange={(e) => onChange({ ...value, isApproximate: e.target.checked })} />
          תאריך משוער (יוצג בקו מקווקו)
        </label>
      )}
      <Input value={value.note} onChange={(e) => onChange({ ...value, note: e.target.value })} placeholder="הערה למעקב: מה הבטיחו / מה לעשות" />
    </div>
  );
}
