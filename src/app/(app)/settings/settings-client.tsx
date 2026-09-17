"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff, Copy, Download, LogOut, RefreshCw, Trash2 } from "lucide-react";
import { api, errorMessage } from "@/lib/client/api";
import { listFailed, removeFailed, type QueuedLead } from "@/lib/client/offline-queue";
import { Button, AnchorButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { ThemeToggle } from "@/components/shell/theme-toggle";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function InstallHelp() {
  const [ios, setIos] = useState(false);
  const [standalone, setStandalone] = useState(true);
  useEffect(() => {
    const ua = navigator.userAgent;
    setIos(/iPhone|iPad|iPod/.test(ua));
    setStandalone(window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
  }, []);
  if (standalone) return <p className="text-sm text-success">✓ האפליקציה מותקנת למסך הבית.</p>;
  return (
    <div className="rounded-xl border border-warning/50 bg-warning/10 p-3 text-sm leading-relaxed">
      <div className="font-bold">חובה להתקין למסך הבית כדי לקבל התראות</div>
      {ios ? (
        <ol className="mt-1 list-decimal ps-5">
          <li>פתח את האתר ב-Safari (לא בכרום).</li>
          <li>לחץ על כפתור השיתוף (הריבוע עם החץ למעלה).</li>
          <li>בחר &quot;הוסף למסך הבית&quot; ואשר.</li>
          <li>פתח את &quot;סבב&quot; מהמסך הבית וחזור לכאן להפעיל התראות.</li>
        </ol>
      ) : (
        <ol className="mt-1 list-decimal ps-5">
          <li>בכרום: תפריט ⋮ → &quot;הוסף למסך הבית&quot; / &quot;התקן אפליקציה&quot;.</li>
          <li>פתח מהמסך הבית והפעל התראות.</li>
        </ol>
      )}
    </div>
  );
}

export function PushControls({ configured, publicKey, subscriptions }: { configured: boolean; publicKey: string | null; subscriptions: number }) {
  const [state, setState] = useState<"unknown" | "unsupported" | "denied" | "subscribed" | "not-subscribed">("unknown");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return setState("unsupported");
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? "subscribed" : "not-subscribed");
    })();
  }, []);

  async function enable() {
    if (!publicKey) return;
    setBusy(true);
    try {
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
      await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState("denied");
        return;
      }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      await api("/api/push", { method: "POST", body: sub.toJSON() });
      setState("subscribed");
      toast("ההתראות הופעלו במכשיר הזה", "success");
      router.refresh();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await api("/api/push", { method: "DELETE", body: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
      }
      setState("not-subscribed");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const r = await api<{ sent: number; failed: number; configured: boolean }>("/api/push/test", { method: "POST" });
      toast(r.configured ? `נשלח ל-${r.sent} מכשירים${r.failed ? `, ${r.failed} נכשלו` : ""}` : "VAPID לא מוגדר בשרת", r.configured ? "success" : "error");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  if (!configured) {
    return (
      <p className="text-sm text-muted-foreground">
        Web Push לא מוגדר בשרת. הרץ <code dir="ltr">npx web-push generate-vapid-keys</code> והגדר <code dir="ltr">VAPID_PUBLIC_KEY</code>, <code dir="ltr">VAPID_PRIVATE_KEY</code>, <code dir="ltr">VAPID_SUBJECT</code>.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm">
        {state === "unsupported" && "הדפדפן הזה לא תומך בהתראות (ב-iOS: רק אחרי התקנה למסך הבית)."}
        {state === "denied" && "ההתראות חסומות בהגדרות הדפדפן/המכשיר."}
        {state === "subscribed" && "✓ ההתראות פעילות במכשיר הזה."}
        {state === "not-subscribed" && "ההתראות עדיין לא הופעלו במכשיר הזה."}
        {state === "unknown" && "בודק…"}
        <span className="text-muted-foreground"> · מכשירים רשומים: {subscriptions}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {state === "not-subscribed" && (
          <Button onClick={enable} disabled={busy}>
            <Bell className="h-4 w-4" /> הפעל התראות במכשיר הזה
          </Button>
        )}
        {state === "subscribed" && (
          <>
            <Button variant="outline" onClick={test} disabled={busy}>
              שלח התראת בדיקה
            </Button>
            <Button variant="ghost" onClick={disable} disabled={busy}>
              <BellOff className="h-4 w-4" /> כבה במכשיר הזה
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export function IcsControls({ url, webcal }: { url: string; webcal: string }) {
  const [current, setCurrent] = useState({ url, webcal });
  const { toast } = useToast();
  async function copy() {
    try {
      await navigator.clipboard.writeText(current.url);
      toast("הכתובת הועתקה", "success");
    } catch {
      toast("לא הצלחתי להעתיק — סמן והעתק ידנית", "error");
    }
  }
  async function rotate() {
    if (!window.confirm("להחליף את הטוקן? יומנים שנרשמו עם הכתובת הישנה יפסיקו להתעדכן.")) return;
    const r = await api<{ url: string; webcal: string }>("/api/settings/ics", { method: "POST" });
    setCurrent(r);
    toast("הטוקן הוחלף", "success");
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">הירשם ליומן הזה מהטלפון (iPhone: הגדרות → יומן → חשבונות → הוסף יומן מנוי). כל משימה מופיעה כאירוע עם התראה.</p>
      <input readOnly value={current.url} dir="ltr" className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs" onFocus={(e) => e.target.select()} />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={copy}>
          <Copy className="h-4 w-4" /> העתק כתובת
        </Button>
        <AnchorButton href={current.webcal} variant="outline">
          פתח ביומן (webcal)
        </AnchorButton>
        <Button variant="ghost" onClick={rotate}>
          <RefreshCw className="h-4 w-4" /> החלף טוקן
        </Button>
      </div>
    </div>
  );
}

const JOBS: Array<[string, string]> = [
  ["morning", "דיגסט בוקר"],
  ["evening", "סיכום יום"],
  ["weekly", "סיכום שבועי"],
  ["automations", "אוטומציות יומיות"],
  ["reminders", "תזכורות למשימות"],
  ["snapshot", "גיבוי עכשיו"],
];

export function JobsPanel() {
  const [busy, setBusy] = useState<string | null>(null);
  const [out, setOut] = useState<string | null>(null);
  const { toast } = useToast();
  async function run(job: string) {
    setBusy(job);
    setOut(null);
    try {
      const r = await api<{ result: unknown }>("/api/admin/jobs", { method: "POST", body: { job } });
      const res = r.result as { text?: string } | null;
      setOut(res && typeof res === "object" && "text" in res && res.text ? String(res.text) : JSON.stringify(r.result, null, 1));
      toast("הורץ", "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {JOBS.map(([job, label]) => (
          <Button key={job} variant="outline" size="sm" onClick={() => run(job)} disabled={busy !== null}>
            {busy === job ? "מריץ…" : label}
          </Button>
        ))}
      </div>
      {out && <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-muted p-3 text-xs">{out}</pre>}
    </div>
  );
}

export function SnapshotsPanel({ snapshots }: { snapshots: Array<{ id: string; createdAt: string; leadCount: number }> }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <AnchorButton href="/api/export/csv" variant="outline">
          <Download className="h-4 w-4" /> ייצוא לאקסל (CSV)
        </AnchorButton>
        <AnchorButton href="/api/export/json" variant="outline">
          <Download className="h-4 w-4" /> גיבוי מלא (JSON)
        </AnchorButton>
      </div>
      <div className="text-sm text-muted-foreground">snapshot יומי אוטומטי (30 אחרונים):</div>
      {snapshots.length === 0 ? (
        <div className="text-sm text-muted-foreground">אין עדיין — נוצר אוטומטית כל בוקר, או דרך &quot;גיבוי עכשיו&quot; למעלה.</div>
      ) : (
        <ul className="text-sm">
          {snapshots.map((s) => (
            <li key={s.id} className="flex items-center justify-between border-t border-border py-1">
              <span>
                {new Date(s.createdAt).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })} · {s.leadCount} לידים
              </span>
              <a href={`/api/snapshots/${s.id}`} className="text-primary underline">
                הורד
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FailedQueuePanel() {
  const [items, setItems] = useState<QueuedLead[]>([]);
  useEffect(() => {
    listFailed().then(setItems);
  }, []);
  if (items.length === 0) return null;
  return (
    <Card>
      <div className="mb-1 font-bold text-danger">שינויים שנשמרו אופליין ונדחו על ידי השרת</div>
      <ul className="text-sm">
        {items.map((i) => (
          <li key={i.id} className="flex items-center justify-between border-t border-border py-1">
            <span>
              {i.title} <span className="text-muted-foreground">({new Date(i.createdAt).toLocaleString("he-IL")})</span>
            </span>
            <button type="button" className="text-danger" onClick={async () => { await removeFailed(i.id); setItems(await listFailed()); }} aria-label="מחק">
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function LogoutButton() {
  const router = useRouter();
  return (
    <Button
      variant="outline"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.replace("/login");
        router.refresh();
      }}
    >
      <LogOut className="h-4 w-4" /> יציאה
    </Button>
  );
}

export function Appearance() {
  return <ThemeToggle />;
}
