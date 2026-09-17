import { ok, withErrors } from "@/lib/api-utils";
import { sendPushToAll } from "@/lib/push";
import { appUrl } from "@/lib/settings";

export const POST = withErrors(async () => {
  const res = await sendPushToAll({ title: "בדיקת התראות ✅", body: "אם אתה רואה את זה — ההתראות עובדות.", url: appUrl("/"), tag: "test" });
  return ok(res);
});
