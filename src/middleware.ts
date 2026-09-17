import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isAuthDisabled, verifySessionToken } from "@/lib/auth";

/** נתיבים פתוחים (בלי cookie): כניסה, cron (מוגן ב-CRON_SECRET), יומן ICS (מוגן בטוקן), קבצי PWA */
const PUBLIC_PREFIXES = [
  "/login",
  "/offline",
  "/api/auth/",
  "/api/cron/",
  "/api/calendar.ics",
  "/api/health",
  "/manifest.webmanifest",
  "/sw.js",
  "/icons/",
  "/favicon.ico",
  "/_next/",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isAuthDisabled()) return NextResponse.next();
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(token)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (pathname !== "/") url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js).*)"],
};
