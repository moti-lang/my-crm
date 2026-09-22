import { ok, withErrors } from "@/lib/api-utils";
import { sendPushToAll } from "@/lib/push";
import { appUrl } from "@/lib/settings";
import { BLACKOUT_LABELS } from "@/lib/hebrew-dates";

export const POST = withErrors(async () => {
  const res = await sendPushToAll({ title: "בדיקת התראות ✅", body: "אם אתה רואה את זה — ההתראות עובדות.", url: appUrl("/"), tag: "test" });
  if (res.blocked) return ok({ ...res, message: `היום ${res.reason ? BLACKOUT_LABELS[res.reason] : "יום חסום"} — ההתראות מושתקות בכל הערוצים, גם לבדיקה` });
  return ok(res);
});
