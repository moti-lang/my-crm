import { ok, readJson, withErrors, type IdCtx } from "@/lib/api-utils";
import { deleteTask, updateTask } from "@/lib/lead-service";
import { taskPatch } from "@/lib/validation";

export const PATCH = withErrors<IdCtx>(async (req, { params }) => {
  const { id } = await params;
  const patch = await readJson(req, taskPatch);
  return ok(await updateTask(id, patch));
});

export const DELETE = withErrors<IdCtx>(async (_req, { params }) => {
  const { id } = await params;
  await deleteTask(id);
  return ok({ ok: true });
});
