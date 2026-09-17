import { prisma } from "@/lib/db";
import { fail, sp, withErrors } from "@/lib/api-utils";
import { safeEqual } from "@/lib/auth";
import { addDaysIL } from "@/lib/dates";
import { buildIcs } from "@/lib/ics";
import { appUrl, getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** יומן ICS להרשמה מהטלפון: /api/calendar.ics?token=... */
export const GET = withErrors(async (req) => {
  const token = sp(req).get("token") ?? "";
  const stored = await getSetting("icsToken");
  if (!token || !stored || !safeEqual(token, stored)) return fail("לא מורשה", 401);
  const tasks = await prisma.task.findMany({
    where: { OR: [{ done: false }, { doneAt: { gte: addDaysIL(new Date(), -30) } }] },
    include: { lead: { select: { id: true, name: true, descriptor: true, area: true, addressNote: true, phone: true } } },
    orderBy: { dueAt: "asc" },
    take: 2000,
  });
  return new Response(buildIcs(tasks, { appUrl: appUrl() }), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="sevev.ics"',
      "Cache-Control": "no-cache",
    },
  });
});
