import { ok, requireMobile } from "@/lib/mobile/auth";
import { beginTiffFile } from "@/lib/mobile/tiff-files";

/* A PHOTO OR PDF FOR TIFF, step one: a slot for its bytes, a signed URL the
   phone PUTs them to. Step two lands it: files/[doc]. */
export async function POST(request: Request) {
  const ctx = await requireMobile(request, "tiff");
  if (ctx instanceof Response) return ctx;
  const body = (await request.json().catch(() => null)) as { fileName?: unknown; mimeType?: unknown; sizeBytes?: unknown } | null;
  const r = await beginTiffFile(ctx, body ?? {});
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status, headers: { "cache-control": "no-store" } });
  return ok(r.value);
}
