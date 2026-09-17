"use client";

import { useEffect, useState } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [db, setDb] = useState<boolean | null>(null);
  useEffect(() => {
    console.error(error);
    fetch("/api/health")
      .then((r) => r.json())
      .then((j) => setDb(Boolean(j.db)))
      .catch(() => setDb(false));
  }, [error]);
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="text-5xl">⚠️</div>
      <h1 className="text-2xl font-bold">משהו השתבש</h1>
      {db === false ? (
        <p className="text-muted-foreground">
          אין חיבור למסד הנתונים. ב-Vercel: Storage → צור/חבר מסד Postgres (Neon) לפרויקט, ואז Deployments → Redeploy. הבנייה מריצה את המיגרציות אוטומטית.
        </p>
      ) : (
        <p className="text-muted-foreground">שגיאה זמנית. נסה שוב, ואם זה חוזר — בדוק את הלוגים ב-Vercel.</p>
      )}
      {error.digest && <code className="text-xs text-muted-foreground">{error.digest}</code>}
      <button type="button" onClick={reset} className="rounded-xl bg-primary px-5 py-3 font-medium text-primary-foreground">
        נסה שוב
      </button>
    </div>
  );
}
