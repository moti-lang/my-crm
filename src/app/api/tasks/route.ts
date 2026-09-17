import { prisma } from "@/lib/db";
import { ok, readJson, sp, withErrors } from "@/lib/api-utils";
import { leadSummarySelect } from "@/lib/leads";
import { createTask } from "@/lib/lead-service";
import { taskInput } from "@/lib/validation";

export const GET = withErrors(async (req) => {
  const q = sp(req);
  const from = q.get("from") ? new Date(q.get("from")!) : undefined;
  const to = q.get("to") ? new Date(q.get("to")!) : undefined;
  const tasks = await prisma.task.findMany({
    where: {
      ...(from || to ? { dueAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
      ...(q.get("open") === "1" ? { done: false } : {}),
    },
    include: { lead: { select: leadSummarySelect } },
    orderBy: { dueAt: "asc" },
    take: 1000,
  });
  return ok(tasks);
});

export const POST = withErrors(async (req) => {
  const input = await readJson(req, taskInput);
  return ok(await createTask(input), { status: 201 });
});
