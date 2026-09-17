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

export function resolveDatabaseUrl(): string | undefined {
  for (const k of KNOWN) if (isPg(process.env[k])) return process.env[k];
  return scan(["_PRISMA_URL", "_URL"]);
}

export function resolveDirectUrl(): string | undefined {
  for (const k of KNOWN_DIRECT) if (isPg(process.env[k])) return process.env[k];
  return scan(["_URL_UNPOOLED", "_URL_NON_POOLING"]) ?? resolveDatabaseUrl();
}
