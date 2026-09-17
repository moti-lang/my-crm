import { prisma } from "@/lib/db";
import { ok, withErrors } from "@/lib/api-utils";
import { createSnapshot } from "@/lib/snapshot";

export const GET = withErrors(async () => {
  const list = await prisma.snapshot.findMany({ select: { id: true, createdAt: true, leadCount: true }, orderBy: { createdAt: "desc" }, take: 30 });
  return ok(list);
});

export const POST = withErrors(async () => ok(await createSnapshot(), { status: 201 }));
