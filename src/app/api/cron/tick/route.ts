import { fail, ok, sp, withErrors } from "@/lib/api-utils";
import { isAuthDisabled, safeEqual } from "@/lib/auth";
import { JOB_NAMES, runTick, type JobName } from "@/lib/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return isAuthDisabled();
  const auth = req.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ") && safeEqual(auth.slice(7), secret)) return true;
  const q = sp(req).get("secret");
  return Boolean(q && safeEqual(q, secret));
}

/** נקרא כל 15 דקות (Vercel Cron). ?job=morning,evening מאלץ הרצה. */
export const GET = withErrors(async (req) => {
  if (!authorized(req)) return fail("לא מורשה", 401);
  const force = (sp(req).get("job") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((j): j is JobName => (JOB_NAMES as string[]).includes(j));
  return ok(await runTick(new Date(), force));
});

export const POST = GET;
