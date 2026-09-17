import { ok, withErrors } from "@/lib/api-utils";
import { appUrl, getOrCreateIcsToken, rotateIcsToken } from "@/lib/settings";

function urls(token: string) {
  const url = appUrl(`/api/calendar.ics?token=${token}`);
  return { url, webcal: url.replace(/^https?:/, "webcal:") };
}

export const GET = withErrors(async () => ok(urls(await getOrCreateIcsToken())));
export const POST = withErrors(async () => ok(urls(await rotateIcsToken())));
