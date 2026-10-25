"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginForm({ next, initialError = null }: { next?: string; initialError?: string | null }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError(res.status === 401 ? "סיסמה שגויה" : "שגיאה בכניסה");
        return;
      }
      router.replace(next && next.startsWith("/") ? next : "/");
      router.refresh();
    } catch {
      setError("אין חיבור לשרת");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} method="post" action="/api/auth/login" className="flex flex-col gap-3">
      {/* שדה משתמש קבוע ומוסתר — בלעדיו iOS/אנדרואיד לא מציעים לשמור את הסיסמה */}
      <input type="text" name="username" autoComplete="username" value="sevev" readOnly tabIndex={-1} aria-hidden="true" className="hidden" />
      {next && <input type="hidden" name="next" value={next} />}
      <Input
        type="password"
        name="password"
        autoFocus
        autoComplete="current-password"
        placeholder="סיסמה"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="text-center text-lg"
      />
      {error && <p className="text-center text-sm text-danger">{error}</p>}
      <Button type="submit" size="lg" disabled={busy || !password}>
        {busy ? "נכנס…" : "כניסה"}
      </Button>
    </form>
  );
}
