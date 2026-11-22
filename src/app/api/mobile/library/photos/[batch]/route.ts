import { after } from "next/server";
import { ok, requireMobile } from "@/lib/mobile/auth";
import { addPages } from "@/lib/mobile/library-pages";
import { askForDrawings } from "@/lib/tiff/ask-drawings";
import { driveDocument } from "@/lib/tiff/ingest";
import { claimDocument, releaseLease } from "@/lib/tiff/lease";

/* A PAPER MANUAL FROM THE PHONE'S CAMERA, step two: the pages, in the order
   taken, made one PDF and put in the Library (lib/mobile/library-pages), then
   read here, after the answer, so it carries on with the phone put away.
   Once it's read, the drawings route reads its photographed pages and then
   its drawings (lib/tiff/after-ready). If the Library on a phone or a tab
   took the reading first, that ends in the same place. */

export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ batch: string }> }) {
  const ctx = await requireMobile(request, "tiff_manage");
  if (ctx instanceof Response) return ctx;
  const body = (await request.json().catch(() => null)) as { count?: unknown; title?: unknown; category?: unknown; tagIds?: unknown } | null;
  const r = await addPages(ctx, (await params).batch.trim(), Number(body?.count), {
    title: String(body?.title ?? ""),
    category: String(body?.category ?? ""),
    tagIds: Array.isArray(body?.tagIds) ? body.tagIds.map(String) : [],
  });
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status, headers: { "cache-control": "no-store" } });

  const documentId = r.value.id;
  const orgId = ctx.orgId;
  const origin = new URL(request.url).origin;
  after(async () => {
    if (!(await claimDocument(documentId, orgId))) return;
    let status: string | null = null;
    try {
      status = (await driveDocument(documentId, orgId)).status;
    } finally {
      await releaseLease(documentId, orgId);
    }
    if (status === "ready") await askForDrawings(origin, documentId, orgId);
  });
  return ok(r.value);
}
