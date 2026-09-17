import { fail, ok, withErrors } from "@/lib/api-utils";
import { importLeads } from "@/lib/import";

export const maxDuration = 60;

/** ייבוא לידים מ-JSON (מדף ההגדרות). לידים קיימים מדולגים. */
export const POST = withErrors(async (req) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("הקובץ אינו JSON תקין", 400);
  }
  return ok(await importLeads(body));
});
