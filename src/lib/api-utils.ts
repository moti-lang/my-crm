import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError, type ZodType, type z } from "zod";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

export async function readJson<S extends ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ZodError([{ code: "custom", message: "גוף הבקשה אינו JSON תקין", path: [] }]);
  }
  return schema.parse(body);
}

type Handler<Ctx> = (req: Request, ctx: Ctx) => Promise<Response>;

/** עוטף route handler: ZodError → 400, רשומה חסרה → 404, אחר → 500 */
export function withErrors<Ctx>(fn: Handler<Ctx>): Handler<Ctx> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof ZodError) {
        const details = e.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
        return fail(details[0]?.message ? `${details[0].path ? details[0].path + ": " : ""}${details[0].message}` : "קלט לא תקין", 400, details);
      }
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") return fail("לא נמצא", 404);
      console.error(`[api] ${req.method} ${new URL(req.url).pathname}`, e);
      return fail((e as Error).message || "שגיאת שרת", 500);
    }
  };
}

export type IdCtx = { params: Promise<{ id: string }> };

export function sp(req: Request): URLSearchParams {
  return new URL(req.url).searchParams;
}
