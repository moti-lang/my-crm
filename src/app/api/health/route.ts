import { prisma } from "@/lib/db";
import { ok } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

export async function GET() {
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {}
  return ok({ ok: db, db, time: new Date().toISOString() }, { status: db ? 200 : 503 });
}
