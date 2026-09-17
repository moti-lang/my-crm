import { prisma } from "@/lib/db";
import { fail, ok, withErrors, type IdCtx } from "@/lib/api-utils";

const MAX_BYTES = 4 * 1024 * 1024;

export const POST = withErrors<IdCtx>(async (req, { params }) => {
  const { id } = await params;
  const form = await req.formData();
  const file = form.get("file");
  const caption = (form.get("caption") as string | null)?.trim() || null;
  if (!(file instanceof File)) return fail("חסר קובץ", 400);
  if (!file.type.startsWith("image/")) return fail("רק תמונות", 400);
  if (file.size > MAX_BYTES) return fail("התמונה גדולה מדי (עד 4MB)", 413);
  const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true } });
  if (!lead) return fail("ליד לא נמצא", 404);
  const bytes = Buffer.from(await file.arrayBuffer());
  const photo = await prisma.photo.create({
    data: { leadId: id, url: "", caption, mimeType: file.type, size: bytes.length, data: bytes },
    select: { id: true },
  });
  const updated = await prisma.photo.update({
    where: { id: photo.id },
    data: { url: `/api/photos/${photo.id}` },
    select: { id: true, url: true, caption: true, createdAt: true },
  });
  return ok(updated, { status: 201 });
});
