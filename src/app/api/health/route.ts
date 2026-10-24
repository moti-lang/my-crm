import { warmDb } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { resolveDatabaseUrl } from "@/lib/db-url";

export const dynamic = "force-dynamic";

export async function GET() {
  let db = false;
  let error: { code?: string; message: string } | undefined;
  try {
    await warmDb(); // ניסיונות חוזרים — מסד Neon רדום מתעורר בינתיים
    db = true;
  } catch (e) {
    error = describeDbError(e);
  }
  const url = resolveDatabaseUrl();
  const dbVar = url ? Object.keys(process.env).find((k) => process.env[k] === url) ?? "unknown" : null;
  const host = url ? safeHost(url) : null;
  return ok({ ok: db, db, dbVar, host, error, time: new Date().toISOString() }, { status: db ? 200 : 503 });
}

/** תיאור שגיאת חיבור בלי לחשוף סיסמה או כתובת מלאה */
function describeDbError(e: unknown): { code?: string; message: string } {
  const err = e as { code?: string; message?: string; errorCode?: string };
  const code = err?.code ?? err?.errorCode;
  const raw = String(err?.message ?? e ?? "unknown").split("\n").filter(Boolean);
  const message = (raw[raw.length - 1] ?? "unknown").replace(/postgres(ql)?:\/\/\S+/g, "postgres://***").slice(0, 300);
  return { code, message };
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
