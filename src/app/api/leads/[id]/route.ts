import { fail, ok, readJson, withErrors, type IdCtx } from "@/lib/api-utils";
import { getLeadFull } from "@/lib/leads";
import { deleteLead, updateLead } from "@/lib/lead-service";
import { leadPatch } from "@/lib/validation";

export const GET = withErrors<IdCtx>(async (_req, { params }) => {
  const { id } = await params;
  const lead = await getLeadFull(id);
  if (!lead) return fail("ליד לא נמצא", 404);
  return ok(lead);
});

export const PATCH = withErrors<IdCtx>(async (req, { params }) => {
  const { id } = await params;
  const patch = await readJson(req, leadPatch);
  return ok(await updateLead(id, patch));
});

export const DELETE = withErrors<IdCtx>(async (_req, { params }) => {
  const { id } = await params;
  await deleteLead(id);
  return ok({ ok: true });
});
