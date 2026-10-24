/**
 * איתור כתובת החיבור ל-Postgres מכל שם משתנה סביבה שאינטגרציה עשויה ליצור
 * (DATABASE_URL, STORAGE_URL, POSTGRES_URL, NEON_*_URL...). עדיפות לשמות המוכרים.
 */
const KNOWN = ["DATABASE_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL", "STORAGE_URL", "NEON_DATABASE_URL"];
const KNOWN_DIRECT = ["DIRECT_DATABASE_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING", "STORAGE_URL_UNPOOLED"];

function isPg(v?: string): v is string {
  return Boolean(v && /^postgres(ql)?:\/\//.test(v));
}

function scan(suffixes: string[]): string | undefined {
  const entries = Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b));
  for (const suffix of suffixes) {
    const hit = entries.find(([k, v]) => k.endsWith(suffix) && isPg(v));
    if (hit) return hit[1];
  }
  return undefined;
}

/**
 * Neon (חינמי) מרדים את המסד אחרי חוסר פעילות; ההתעוררות לוקחת כמה שניות.
 * ברירת המחדל של Prisma (5 שניות) נכשלת לעיתים — מאריכים את זמן ההתחברות אם לא הוגדר.
 */
export function withConnectTimeout(url: string, seconds = 20): string {
  try {
    const u = new URL(url);
    if (!u.searchParams.has("connect_timeout")) u.searchParams.set("connect_timeout", String(seconds));
    if (!u.searchParams.has("pool_timeout")) u.searchParams.set("pool_timeout", String(seconds));
    return u.toString();
  } catch {
    return url;
  }
}

export function resolveDatabaseUrl(): string | undefined {
  for (const k of KNOWN) if (isPg(process.env[k])) return process.env[k];
  return scan(["_PRISMA_URL", "_URL"]);
}

export function resolveDirectUrl(): string | undefined {
  for (const k of KNOWN_DIRECT) if (isPg(process.env[k])) return process.env[k];
  return scan(["_URL_UNPOOLED", "_URL_NON_POOLING"]) ?? resolveDatabaseUrl();
}
