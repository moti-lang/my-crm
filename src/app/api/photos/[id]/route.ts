import { prisma } from "@/lib/db";
import { fail, ok, withErrors, type IdCtx } from "@/lib/api-utils";

export const GET = withErrors<IdCtx>(async (_req, { params }) => {
  const { id } = await params;
  const photo = await prisma.photo.findUnique({ where: { id }, select: { data: true, mimeType: true } });
  if (!photo?.data) return fail("תמונה לא נמצאה", 404);
  return new Response(new Uint8Array(photo.data), {
    headers: {
      "Content-Type": photo.mimeType ?? "image/jpeg",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
});

export const DELETE = withErrors<IdCtx>(async (_req, { params }) => {
  const { id } = await params;
  await prisma.photo.delete({ where: { id } });
  return ok({ ok: true });
});
