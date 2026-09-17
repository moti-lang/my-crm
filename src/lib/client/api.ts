"use client";

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
export class OfflineError extends Error {
  constructor() {
    super("אין חיבור לרשת");
  }
}

export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; formData?: FormData; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.body || init.formData ? "POST" : "GET"),
      headers: init.formData ? undefined : init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.formData ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
      signal: init.signal,
      credentials: "same-origin",
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new OfflineError();
  }
  if (res.status === 401) {
    if (typeof window !== "undefined") window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw new ApiError("לא מחובר", 401);
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const errObj = data && typeof data === "object" ? (data as { error?: unknown; details?: unknown }) : null;
    const msg = errObj?.error ? String(errObj.error) : `שגיאה ${res.status}`;
    throw new ApiError(msg, res.status, errObj?.details);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof OfflineError) return e.message;
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "שגיאה לא צפויה";
}
