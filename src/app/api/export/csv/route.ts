import { prisma } from "@/lib/db";
import { withErrors } from "@/lib/api-utils";
import { leadsToCsv } from "@/lib/csv";
import { ymdIL } from "@/lib/dates";

export const dynamic = "force-dynamic";

export const GET = withErrors(async () => {
  const leads = await prisma.lead.findMany({ orderBy: [{ area: "asc" }, { createdAt: "asc" }] });
  return new Response(leadsToCsv(leads), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${ymdIL(new Date())}.csv"`,
    },
  });
});
