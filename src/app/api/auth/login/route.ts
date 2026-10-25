import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, checkPassword, createSessionToken, isAuthConfigured, sessionCookieOptions } from "@/lib/auth";
import { fail, readJson, withErrors } from "@/lib/api-utils";

const schema = z.object({ password: z.string().min(1), next: z.string().optional() });

/** כניסה: JSON (מהאפליקציה) או טופס רגיל (אם ה-JS עוד לא נטען בטלפון איטי) — שניהם מקבלים cookie לשנה */
export const POST = withErrors(async (req) => {
  if (!isAuthConfigured()) return fail("לא הוגדרה סיסמה (APP_PASSWORD)", 503);
  const isForm = (req.headers.get("content-type") ?? "").includes("form");
  const input = isForm
    ? schema.parse(Object.fromEntries((await req.formData()).entries()))
    : await readJson(req, schema);
  if (!checkPassword(input.password)) {
    if (isForm) return NextResponse.redirect(new URL("/login?error=1", req.url), 303);
    return fail("סיסמה שגויה", 401);
  }
  const target = input.next && input.next.startsWith("/") ? input.next : "/";
  const res = isForm ? NextResponse.redirect(new URL(target, req.url), 303) : NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(), sessionCookieOptions());
  return res;
});
