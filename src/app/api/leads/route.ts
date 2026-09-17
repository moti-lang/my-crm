import { ok, readJson, sp, withErrors } from "@/lib/api-utils";
import { listLeads, type LeadFilters } from "@/lib/leads";
import { createLead } from "@/lib/lead-service";
import { leadInput } from "@/lib/validation";

export const GET = withErrors(async (req) => {
  const q = sp(req);
  const filters: LeadFilters = {
    q: q.get("q") ?? undefined,
    area: q.get("area") ?? undefined,
    status: q.get("status") ?? undefined,
    heat: q.get("heat") ?? undefined,
    category: q.get("category") ?? undefined,
    phone: (q.get("phone") as LeadFilters["phone"]) ?? undefined,
    due: (q.get("due") as LeadFilters["due"]) ?? undefined,
    stuck: q.get("stuck") === "1",
    sort: (q.get("sort") as LeadFilters["sort"]) ?? undefined,
    take: q.get("take") ? Number(q.get("take")) : undefined,
  };
  return ok(await listLeads(filters));
});

export const POST = withErrors(async (req) => {
  const input = await readJson(req, leadInput);
  const lead = await createLead(input);
  return ok(lead, { status: 201 });
});
