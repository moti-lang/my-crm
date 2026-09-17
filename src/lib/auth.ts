/**
 * אימות משתמש יחיד: סיסמה + cookie חתום (HMAC) לשנה.
 * משתמש ב-Web Crypto כדי לעבוד גם ב-middleware (Edge) וגם ב-Node.
 */
export const SESSION_COOKIE = "crm_session";
const YEAR_SECONDS = 365 * 24 * 60 * 60;

function secret(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (process.env.APP_PASSWORD) return `derived:${process.env.APP_PASSWORD}`;
  return "";
}

export function isAuthDisabled(): boolean {
  return ["1", "true", "yes"].includes((process.env.AUTH_DISABLED ?? "").toLowerCase());
}

export function isAuthConfigured(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

async function hmacHex(data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionToken(): Promise<string> {
  const exp = Date.now() + YEAR_SECONDS * 1000;
  return `${exp}.${await hmacHex(String(exp))}`;
}

export async function verifySessionToken(token?: string | null): Promise<boolean> {
  if (!token || !secret()) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig) return false;
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const expected = await hmacHex(exp);
  return safeEqual(sig, expected);
}

export function checkPassword(input: string): boolean {
  const pw = process.env.APP_PASSWORD ?? "";
  if (!pw) return false;
  return safeEqual(input, pw);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: YEAR_SECONDS,
  };
}
