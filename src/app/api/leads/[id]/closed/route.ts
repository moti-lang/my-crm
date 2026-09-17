import { ok, withErrors, type IdCtx } from "@/lib/api-utils";
import { markSawClosed } from "@/lib/lead-service";

/** "ראיתי שסגור" — רישום מהיר שמזיז את המעקב */
export const POST = withErrors<IdCtx>(async (_req, { params }) => {
  const { id } = await params;
  return ok(await markSawClosed(id));
});
