import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, checkPassword, createSessionToken, isAuthConfigured, sessionCookieOptions } from "@/lib/auth";
import { fail, readJson, withErrors } from "@/lib/api-utils";

const schema = z.object({ password: z.string().min(1) });

export const POST = withErrors(async (req) => {
  if (!isAuthConfigured()) return fail("לא הוגדרה סיסמה (APP_PASSWORD)", 503);
  const { password } = await readJson(req, schema);
  if (!checkPassword(password)) return fail("סיסמה שגויה", 401);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(), sessionCookieOptions());
  return res;
});
