import { ok, requireMobile } from "@/lib/mobile/auth";
import { landTiffFile } from "@/lib/mobile/tiff-files";

/* A PHOTO OR PDF FOR TIFF, step two: its bytes are in, and it can be read for her answer. */
export async function POST(request: Request, { params }: { params: Promise<{ doc: string }> }) {
  const ctx = await requireMobile(request, "tiff");
  if (ctx instanceof Response) return ctx;
  const r = await landTiffFile(ctx, (await params).doc.trim().slice(0, 80));
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status, headers: { "cache-control": "no-store" } });
  return ok(r.value);
}
