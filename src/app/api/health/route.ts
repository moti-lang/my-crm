import { prisma } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { resolveDatabaseUrl } from "@/lib/db-url";

export const dynamic = "force-dynamic";

export async function GET() {
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {}
  const url = resolveDatabaseUrl();
  const dbVar = url ? Object.keys(process.env).find((k) => process.env[k] === url) ?? "unknown" : null;
  return ok({ ok: db, db, dbVar, time: new Date().toISOString() }, { status: db ? 200 : 503 });
}
