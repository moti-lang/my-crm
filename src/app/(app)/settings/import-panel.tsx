"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { api, errorMessage } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

interface Result {
  total: number;
  created: number;
  skipped: number;
  errors: Array<{ lead: string; error: string }>;
}

export function ImportPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const { toast } = useToast();
  const router = useRouter();

  async function send(json: string) {
    setBusy(true);
    setResult(null);
    try {
      const parsed = JSON.parse(json);
      const r = await api<Result>("/api/import", { method: "POST", body: parsed });
      setResult(r);
      toast(`יובאו ${r.created} לידים${r.skipped ? `, ${r.skipped} דולגו (קיימים)` : ""}`, r.errors.length ? "error" : "success");
      router.refresh();
    } catch (e) {
      toast(e instanceof SyntaxError ? "הטקסט אינו JSON תקין" : errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    send(await f.text());
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">קובץ JSON עם מערך `leads` (שם/תיאור, אזור, טלפון, סטטוס, מעקב הבא, מגעים…). לידים שכבר קיימים (אותו שם ואזור) מדולגים, אז אפשר להריץ שוב.</p>
      <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={onFile} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => fileRef.current?.click()} disabled={busy}>
          <Upload className="h-4 w-4" /> {busy ? "מייבא…" : "בחר קובץ JSON לייבוא"}
        </Button>
      </div>
      <details>
        <summary className="cursor-pointer text-sm text-muted-foreground">או הדבק JSON כאן</summary>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} dir="ltr" className="mt-2 min-h-24 text-xs" placeholder='{"leads":[...]}' />
        <Button variant="outline" size="sm" className="mt-2" onClick={() => send(text)} disabled={busy || !text.trim()}>
          ייבא מהטקסט
        </Button>
      </details>
      {result && (
        <div className="rounded-xl bg-muted p-3 text-sm">
          <div>
            סה״כ בקובץ: {result.total} · נוצרו: <b>{result.created}</b> · דולגו (קיימים): {result.skipped} · שגיאות: {result.errors.length}
          </div>
          {result.errors.length > 0 && (
            <ul className="mt-1 text-danger">
              {result.errors.map((e, i) => (
                <li key={i}>
                  {e.lead}: {e.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
