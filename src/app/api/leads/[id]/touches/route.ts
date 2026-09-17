import { ok, readJson, withErrors, type IdCtx } from "@/lib/api-utils";
import { addTouch } from "@/lib/lead-service";
import { touchInput } from "@/lib/validation";

export const POST = withErrors<IdCtx>(async (req, { params }) => {
  const { id } = await params;
  const input = await readJson(req, touchInput);
  return ok(await addTouch(id, input), { status: 201 });
});
