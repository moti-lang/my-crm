"use client";

import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { useToast } from "@/components/ui/toast";

interface CalendarInfo {
  blockCholHamoed: boolean;
  today: { ymd: string; blocked: boolean; reason: string | null; label: string | null };
  upcoming: Array<{ ymd: string; reason: string; label: string }>;
}

/** חסימת התראות בשבת וחג + הגדרת חול המועד */
export function CalendarPanel() {
  const [info, setInfo] = useState<CalendarInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    api<CalendarInfo>("/api/settings/calendar").then(setInfo).catch(() => undefined);
  }, []);

  async function toggle(v: boolean) {
    setBusy(true);
    try {
      setInfo(await api<CalendarInfo>("/api/settings/calendar", { method: "PATCH", body: { blockCholHamoed: v } }));
      toast(v ? "חול המועד חסום" : "חול המועד פתוח", "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  const fmt = (ymd: string) => ymd.split("-").reverse().slice(0, 2).map(Number).join(".");

  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>
        בשבת, יום טוב, ערב שבת וערב יום טוב לא נשלחת אף התראה, בשום ערוץ (Push, וואטסאפ, תזכורות, דיגסטים). החסימה לפי תאריך בשעון ישראל: הערב חסום כל היום. מה שנחסם מגיע בדיגסט הבוקר הראשון שאחרי, מקובץ לפי ליד. ביומן (ICS) אין התראות בימים חסומים.
      </p>
      <label className="flex min-h-11 items-center gap-2 font-medium">
        <input type="checkbox" className="h-5 w-5" checked={info?.blockCholHamoed ?? true} disabled={!info || busy} onChange={(e) => toggle(e.target.checked)} />
        לחסום גם בחול המועד (ברירת מחדל: כן). משפיע גם על קביעת תאריכים — חול המועד מדולג כמו שבת וחג.
      </label>
      {info && (
        <>
          <div className={info.today.blocked ? "rounded-xl bg-warning/10 px-3 py-2 text-warning" : "rounded-xl bg-success/10 px-3 py-2 text-success"}>
            {info.today.blocked ? `היום ${info.today.label} — ההתראות מושתקות` : "היום ההתראות פעילות"}
          </div>
          {info.upcoming.length > 0 && (
            <div className="text-muted-foreground">
              ימים חסומים ב-30 הימים הקרובים:{" "}
              {info.upcoming.map((d) => `${fmt(d.ymd)} (${d.label})`).join(" · ")}
            </div>
          )}
        </>
      )}
    </div>
  );
}
