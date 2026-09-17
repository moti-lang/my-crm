import { withErrors } from "@/lib/api-utils";
import { ymdIL } from "@/lib/dates";
import { exportAll } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export const GET = withErrors(async () => {
  const data = await exportAll();
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="sevev-backup-${ymdIL(new Date())}.json"`,
    },
  });
});
