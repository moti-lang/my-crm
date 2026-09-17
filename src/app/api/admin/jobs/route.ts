import { z } from "zod";
import { ok, readJson, withErrors } from "@/lib/api-utils";
import { JOB_NAMES, runJob } from "@/lib/cron";

export const maxDuration = 60;

/** הרצה ידנית של עבודה (מאחורי הכניסה) — לבדיקת התראות */
export const POST = withErrors(async (req) => {
  const { job } = await readJson(req, z.object({ job: z.enum(JOB_NAMES as [string, ...string[]]) }));
  return ok({ job, result: await runJob(job as (typeof JOB_NAMES)[number]) });
});
