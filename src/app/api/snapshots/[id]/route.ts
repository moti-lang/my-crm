import { prisma } from "@/lib/db";
import { fail, withErrors, type IdCtx } from "@/lib/api-utils";
import { ymdIL } from "@/lib/dates";

export const GET = withErrors<IdCtx>(async (_req, { params }) => {
  const { id } = await params;
  const snap = await prisma.snapshot.findUnique({ where: { id } });
  if (!snap) return fail("לא נמצא", 404);
  return new Response(JSON.stringify(snap.data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="sevev-snapshot-${ymdIL(snap.createdAt)}.json"`,
    },
  });
});
