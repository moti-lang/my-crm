import { prisma } from "./db";

export async function getSetting(key: string): Promise<string | null> {
  const s = await prisma.setting.findUnique({ where: { key } });
  return s?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

function randomToken(bytes = 24): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** טוקן קבוע לכתובת ה-ICS (נוצר בפעם הראשונה) */
export async function getOrCreateIcsToken(): Promise<string> {
  const existing = await getSetting("icsToken");
  if (existing) return existing;
  const token = randomToken();
  await setSetting("icsToken", token);
  return token;
}

export async function rotateIcsToken(): Promise<string> {
  const token = randomToken();
  await setSetting("icsToken", token);
  return token;
}

export function appUrl(path = ""): string {
  const explicit = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  const base = (explicit || (vercel ? `https://${vercel}` : "http://localhost:3000")).replace(/\/$/, "");
  return `${base}${path}`;
}
