import { PrismaClient } from "@prisma/client";
import { resolveDatabaseUrl, withConnectTimeout } from "./db-url";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** תומך בשמות המשתנים של האינטגרציות: Neon (DATABASE_URL), Vercel Postgres / Supabase (POSTGRES_PRISMA_URL, POSTGRES_URL) */
const datasourceUrl = (() => {
  const u = resolveDatabaseUrl();
  return u ? withConnectTimeout(u) : undefined;
})();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(datasourceUrl ? { datasourceUrl } : {}),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;

/**
 * מחמם את החיבור למסד: Neon רדום מתעורר תוך כמה שניות, ולכן ניסיון ראשון עלול להיכשל.
 * מנסה עד שלוש פעמים לפני שמרימים שגיאה — כך הדף לא נופל על "אין חיבור למסד" סתם בגלל התעוררות.
 */
export async function warmDb(attempts = 3, delayMs = 1500): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}
