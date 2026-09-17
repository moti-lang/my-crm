import { PrismaClient } from "@prisma/client";
import { resolveDatabaseUrl } from "./db-url";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** תומך בשמות המשתנים של האינטגרציות: Neon (DATABASE_URL), Vercel Postgres / Supabase (POSTGRES_PRISMA_URL, POSTGRES_URL) */
const datasourceUrl = resolveDatabaseUrl();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(datasourceUrl ? { datasourceUrl } : {}),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
