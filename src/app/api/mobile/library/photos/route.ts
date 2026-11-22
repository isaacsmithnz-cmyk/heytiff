import { ok, requireMobile } from "@/lib/mobile/auth";
import { beginPages } from "@/lib/mobile/library-pages";

/* A PAPER MANUAL FROM THE PHONE'S CAMERA, step one (lib/mobile/library-pages):
   a signed slot for each page's photo, which the phone PUTs to. Step two,
   photos/[batch], makes them one PDF in the Library and reads it. Behind
   `tiff_manage`, as every door into the Library is. */
export async function POST(request: Request) {
  const ctx = await requireMobile(request, "tiff_manage");
  if (ctx instanceof Response) return ctx;
  const body = (await request.json().catch(() => null)) as { pages?: unknown } | null;
  const types = Array.isArray(body?.pages) ? body.pages.map((p) => String((p as { mimeType?: unknown })?.mimeType ?? "")) : [];
  const r = await beginPages(ctx, types);
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status, headers: { "cache-control": "no-store" } });
  return ok(r.value);
}
