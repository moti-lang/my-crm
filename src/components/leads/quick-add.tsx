"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, MicOff, Sparkles, Wand2 } from "lucide-react";
import { api, OfflineError, errorMessage } from "@/lib/client/api";
import { enqueueLead } from "@/lib/client/offline-queue";
import { emptyLeadForm, parsedToForm, type LeadFormValues } from "@/lib/client/lead-form-model";
import type { ParseResult } from "@/lib/parse-local";
import { useSpeech } from "@/lib/client/use-speech";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { LeadForm } from "./lead-form";

const EXAMPLE = "נגריה ליד רחוב הסלע, דיברתי עם עדי, מבטיחה לחזור ביום חמישי, אין טלפון. ראיתי הרבה ניירת ולוח מחיק עם הזמנות";

export function QuickAdd({ areas, categories, claude }: { areas: string[]; categories: string[]; claude: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [mode, setMode] = useState<"text" | "form">("text");
  const [text, setText] = useState("");
  const [interim, setInterim] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ form: LeadFormValues; meta: ParseResult } | null>(null);

  const onFinal = useCallback((t: string) => {
    setText((s) => (s ? `${s} ${t}` : t));
    setInterim("");
  }, []);
  const speech = useSpeech(onFinal, setInterim);

  async function parse() {
    const raw = text.trim();
    if (raw.length < 2) return;
    setBusy(true);
    try {
      let meta: ParseResult;
      try {
        meta = await api<ParseResult>("/api/parse", { method: "POST", body: { text: raw } });
      } catch (e) {
        if (!(e instanceof OfflineError)) throw e;
        // אופליין: פירוש מקומי בדפדפן
        const { localParse, postProcess } = await import("@/lib/parse-local");
        const processed = postProcess(localParse(raw), raw, new Date());
        meta = { ...processed, source: "local", error: "אין חיבור — פירוש מקומי" };
      }
      setResult({ form: parsedToForm(meta.lead, raw), meta });
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveRaw() {
    const raw = text.trim();
    if (!raw) return;
    const payload = { descriptor: raw.split(" ").slice(0, 6).join(" "), notes: raw, initialTouch: { type: "VISIT", summary: raw } };
    setBusy(true);
    try {
      const lead = await api<{ id: string }>("/api/leads", { method: "POST", body: payload });
      toast("נשמר כטיוטה — אפשר להשלים פרטים אחר כך", "success");
      router.push(`/leads/${lead.id}`);
    } catch (e) {
      if (e instanceof OfflineError) {
        await enqueueLead(payload, payload.descriptor);
        toast("אין חיבור — נשמר במכשיר ויסונכרן אוטומטית", "info");
        router.push("/");
        return;
      }
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const m = result.meta;
    return (
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">לאישור ועריכה</h2>
          <button type="button" className="text-sm text-primary underline" onClick={() => setResult(null)}>
            חזרה לטקסט
          </button>
        </div>
        <LeadForm
          initial={result.form}
          mode="create"
          areas={areas}
          categories={categories}
          banner={
            <div className="flex flex-col gap-1 rounded-xl bg-muted px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                {m.source === "claude" ? "פורק על ידי Claude" : "פירוש מקומי (בלי Claude)"}
                {m.error && <span className="text-muted-foreground">· {m.error}</span>}
              </div>
              {m.warnings.map((w) => (
                <div key={w} className="text-warning">
                  ⚠️ {w}
                </div>
              ))}
              {m.dateConflict && <div className="text-warning">⚠️ {m.dateConflict.message}</div>}
              <div className="text-muted-foreground">בדוק את השדות — במיוחד תאריך המעקב — ולחץ שמור.</div>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Tabs
        value={mode}
        onChange={setMode}
        items={[
          { value: "text", label: "טקסט חופשי" },
          { value: "form", label: "טופס" },
        ]}
      />
      {mode === "form" ? (
        <LeadForm initial={emptyLeadForm()} mode="create" areas={areas} categories={categories} />
      ) : (
        <Card className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">כתוב או הכתב מה קרה. המערכת תמלא את השדות ותציג לאישור.</p>
          <div className="relative">
            <Textarea
              value={interim ? `${text}${text ? " " : ""}${interim}` : text}
              onChange={(e) => setText(e.target.value)}
              placeholder={EXAMPLE}
              className="min-h-44 pe-12 text-lg leading-relaxed"
              autoFocus
            />
            {speech.supported && (
              <button
                type="button"
                onClick={speech.toggle}
                className={`absolute end-2 top-2 flex h-11 w-11 items-center justify-center rounded-full ${speech.listening ? "bg-danger text-white" : "bg-muted"}`}
                aria-label="הכתבה קולית"
              >
                {speech.listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </button>
            )}
          </div>
          {speech.listening && <div className="text-sm text-danger">🎙 מקשיב… דבר בעברית</div>}
          <Button size="lg" onClick={parse} disabled={busy || text.trim().length < 2}>
            <Wand2 className="h-5 w-5" />
            {busy ? "מפרק…" : "פרק ומלא טופס"}
          </Button>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{claude ? "פירוק חכם: Claude" : "Claude לא מוגדר — פירוש מקומי בסיסי"}</span>
            <button type="button" className="underline" onClick={saveRaw} disabled={busy || !text.trim()}>
              שמור כמו שזה בלי פירוק
            </button>
          </div>
          <div className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
            טיפים: &quot;דיברתי עם X&quot; · &quot;מבטיח לחזור ביום חמישי&quot; · &quot;אחרי החג&quot; · &quot;אין טלפון&quot; · &quot;ישב איתי חצי שעה&quot; · &quot;ראיתי…&quot;
          </div>
        </Card>
      )}
    </div>
  );
}
