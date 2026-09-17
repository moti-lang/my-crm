"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin } from "lucide-react";
import { ACTION_META, ACTION_TYPES, HEATS, HEAT_META, KNOWN_CATEGORIES, LEAD_STATUSES, STATUS_META, TIMES_OF_DAY, TIME_OF_DAY_META, defaultTimeOfDay, type TimeOfDay } from "@/lib/categories";
import { api, OfflineError, errorMessage } from "@/lib/client/api";
import { enqueueLead } from "@/lib/client/offline-queue";
import { formTitle, formToPayload, type LeadFormValues } from "@/lib/client/lead-form-model";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { NextActionPicker } from "./next-action-picker";

const ROLES = ["בעלים", "מנהל/ת", "פקיד/ה", "שותף/ה", "אחראי/ת"];

export function LeadForm({
  initial,
  mode,
  leadId,
  areas = [],
  categories = [],
  banner,
  onCancel,
}: {
  initial: LeadFormValues;
  mode: "create" | "edit";
  leadId?: string;
  areas?: string[];
  categories?: string[];
  banner?: React.ReactNode;
  onCancel?: () => void;
}) {
  const [v, setV] = useState<LeadFormValues>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gps, setGps] = useState<string | null>(initial.lat != null ? "יש מיקום שמור" : null);
  const router = useRouter();
  const { toast } = useToast();

  const set = <K extends keyof LeadFormValues>(k: K, val: LeadFormValues[K]) => setV((s) => ({ ...s, [k]: val }));
  const hasPhone = Boolean(v.phone.trim());

  function captureGps() {
    if (!navigator.geolocation) {
      setGps("אין GPS במכשיר");
      return;
    }
    setGps("מאתר…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setV((s) => ({ ...s, lat: pos.coords.latitude, lng: pos.coords.longitude }));
        setGps(`נשמר (±${Math.round(pos.coords.accuracy)} מ׳)`);
      },
      () => setGps("לא הצלחתי לאתר"),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!v.name.trim() && !v.descriptor.trim()) {
      setError("חובה שם עסק או תיאור מזהה");
      return;
    }
    setBusy(true);
    setError(null);
    const payload = formToPayload(v, mode);
    try {
      if (mode === "create") {
        const lead = await api<{ id: string }>("/api/leads", { method: "POST", body: payload });
        toast("הליד נשמר", "success");
        router.push(`/leads/${lead.id}`);
        router.refresh();
      } else {
        await api(`/api/leads/${leadId}`, { method: "PATCH", body: payload });
        toast("עודכן", "success");
        router.push(`/leads/${leadId}`);
        router.refresh();
      }
    } catch (err) {
      if (err instanceof OfflineError && mode === "create") {
        await enqueueLead(payload, formTitle(v));
        toast("אין חיבור — הליד נשמר במכשיר ויסונכרן אוטומטית", "info");
        router.push("/");
        return;
      }
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {banner}

      <Card className="flex flex-col gap-3">
        <div className="font-bold">זיהוי</div>
        <Field label="תיאור מזהה" hint="חובה אם אין שם">
          <Input value={v.descriptor} onChange={(e) => set("descriptor", e.target.value)} placeholder='נגריה ליד רחוב הסלע / "משרד בקומה 2"' autoFocus={mode === "create"} />
        </Field>
        <Field label="שם העסק" hint="אם ידוע">
          <Input value={v.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
      </Card>

      <Card className="flex flex-col gap-3">
        <div className="font-bold">מיקום</div>
        <Field label="אזור / רחוב ראשי">
          <Input list="areas-list" value={v.area} onChange={(e) => set("area", e.target.value)} placeholder="רחוב הסלע / תלפיות / הר טוב" />
          <datalist id="areas-list">
            {areas.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </Field>
        <Field label="הערת מיקום">
          <Input value={v.addressNote} onChange={(e) => set("addressNote", e.target.value)} placeholder="בניין הסלע, קומה תחתונה" />
        </Field>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={captureGps}>
            <MapPin className="h-4 w-4" /> שמור מיקום GPS
          </Button>
          {gps && <span className="text-sm text-muted-foreground">{gps}</span>}
          {v.lat != null && (
            <button type="button" className="text-sm text-danger underline" onClick={() => { set("lat", null); set("lng", null); setGps(null); }}>
              נקה
            </button>
          )}
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <div className="font-bold">תחום</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="תחום העסק">
            <Input
              list="categories-list"
              value={v.category}
              onChange={(e) => {
                const c = e.target.value;
                setV((s) => ({ ...s, category: c, bestTimeOfDay: s.bestTimeOfDay === "ANY" || s.bestTimeOfDay === defaultTimeOfDay(s.category) ? defaultTimeOfDay(c) : s.bestTimeOfDay }));
              }}
              placeholder="נגרייה / הסעות / קמעונאות"
            />
            <datalist id="categories-list">
              {[...new Set([...categories, ...KNOWN_CATEGORIES])].map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="זמן ביקור מועדף" hint="תעשייה בבוקר, קמעונאות אחה״צ">
            <Select value={v.bestTimeOfDay} onChange={(e) => set("bestTimeOfDay", e.target.value as TimeOfDay)}>
              {TIMES_OF_DAY.map((t) => (
                <option key={t} value={t}>
                  {TIME_OF_DAY_META[t].label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <div className="font-bold">איש קשר</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="שם">
            <Input value={v.contactName} onChange={(e) => set("contactName", e.target.value)} />
          </Field>
          <Field label="תפקיד">
            <Input list="roles-list" value={v.contactRole} onChange={(e) => set("contactRole", e.target.value)} />
            <datalist id="roles-list">
              {ROLES.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </Field>
          <Field label="טלפון" hint={!hasPhone ? "בלי טלפון = מסלול כניסה פיזית" : undefined}>
            <Input type="tel" inputMode="tel" dir="ltr" className="text-start" value={v.phone} onChange={(e) => set("phone", e.target.value)} placeholder="052-1234567" />
          </Field>
          <Field label="מייל">
            <Input type="email" inputMode="email" dir="ltr" className="text-start" value={v.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field label="אתר" className="sm:col-span-2">
            <Input inputMode="url" dir="ltr" className="text-start" value={v.website} onChange={(e) => set("website", e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <div className="font-bold">סטטוס וחום</div>
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {HEATS.map((h) => (
            <Chip key={h} active={v.heat === h} onClick={() => set("heat", h)} title={HEAT_META[h].hint}>
              {HEAT_META[h].emoji} {HEAT_META[h].label}
            </Chip>
          ))}
        </div>
        <Select value={v.status} onChange={(e) => set("status", e.target.value as LeadFormValues["status"])}>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label} — {STATUS_META[s].hint}
            </option>
          ))}
        </Select>
        {(v.status === "LOST" || v.status === "PARKED" || v.status === "WON") && (
          <Field label={v.status === "WON" ? "הערת סגירה" : "סיבה"}>
            <Input value={v.closedReason} onChange={(e) => set("closedReason", e.target.value)} />
          </Field>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <div className="font-bold">המעקב הבא</div>
        <NextActionPicker value={v.next} onChange={(n) => set("next", n)} hasPhone={hasPhone} />
      </Card>

      <Card className="flex flex-col gap-3">
        <div className="font-bold">מה ראיתי</div>
        <Textarea value={v.observation} onChange={(e) => set("observation", e.target.value)} placeholder="ניירת על השולחן, תור בכניסה, לוח מחיק עם הזמנות, 3 עובדים…" />
        <Field label="כאבים">
          <Textarea value={v.painPoints} onChange={(e) => set("painPoints", e.target.value)} className="min-h-16" />
        </Field>
        <Field label="במה עובדים היום">
          <Input value={v.currentTools} onChange={(e) => set("currentTools", e.target.value)} placeholder="אקסל / מחברת / וואטסאפ / תוכנה ישנה" />
        </Field>
        <Field label="הערות חופשיות">
          <Textarea value={v.notes} onChange={(e) => set("notes", e.target.value)} className="min-h-16" />
        </Field>
      </Card>

      {mode === "create" && (
        <Card className="flex flex-col gap-3">
          <label className="flex min-h-11 items-center gap-2 font-bold">
            <input type="checkbox" className="h-5 w-5" checked={v.initialTouch.enabled} onChange={(e) => set("initialTouch", { ...v.initialTouch, enabled: e.target.checked })} />
            רשום מגע ראשון (הביקור הזה)
          </label>
          {v.initialTouch.enabled && (
            <>
              <div className="no-scrollbar flex gap-2 overflow-x-auto">
                {ACTION_TYPES.map((t) => (
                  <Chip key={t} active={v.initialTouch.type === t} onClick={() => set("initialTouch", { ...v.initialTouch, type: t })}>
                    {ACTION_META[t].emoji} {ACTION_META[t].label}
                  </Chip>
                ))}
              </div>
              <Textarea value={v.initialTouch.summary} onChange={(e) => set("initialTouch", { ...v.initialTouch, summary: e.target.value })} placeholder="מה קרה בביקור" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="עם מי">
                  <Input value={v.initialTouch.withWhom} onChange={(e) => set("initialTouch", { ...v.initialTouch, withWhom: e.target.value })} />
                </Field>
                <Field label="כמה זמן (דקות)">
                  <Input type="number" inputMode="numeric" min={0} value={v.initialTouch.durationMin ?? ""} onChange={(e) => set("initialTouch", { ...v.initialTouch, durationMin: e.target.value ? Number(e.target.value) : null })} />
                </Field>
              </div>
            </>
          )}
        </Card>
      )}

      {error && <div className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}

      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 flex gap-2 rounded-2xl border border-border bg-card/95 p-2 backdrop-blur md:bottom-4">
        <Button type="submit" size="lg" className="flex-1" disabled={busy}>
          {busy ? "שומר…" : mode === "create" ? "שמור ליד" : "שמור שינויים"}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" size="lg" onClick={onCancel}>
            ביטול
          </Button>
        )}
      </div>
    </form>
  );
}
