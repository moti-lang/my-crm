import { ok, readJson, withErrors, type IdCtx } from "@/lib/api-utils";
import { deleteTouch, updateTouch } from "@/lib/lead-service";
import { touchPatch } from "@/lib/validation";

export const PATCH = withErrors<IdCtx>(async (req, { params }) => {
  const { id } = await params;
  const patch = await readJson(req, touchPatch);
  return ok(await updateTouch(id, patch));
});

export const DELETE = withErrors<IdCtx>(async (_req, { params }) => {
  const { id } = await params;
  await deleteTouch(id);
  return ok({ ok: true });
});
