import { kbDocsForOrg } from "@/lib/tiff/query";
import { ok, requireMobile } from "@/lib/mobile/auth";

/* THE LIBRARY'S DOCUMENTS for the phone's shelves, newest first, as the
   Library page lists them (kbDocsForOrg: confirmed uploads only), behind the
   same `tiff` grant. Only what a shelf row says: no storage reference, so a
   file is opened through /library/[id]/file, signed on demand, never from a
   list. */
export async function GET(request: Request) {
  const ctx = await requireMobile(request, "tiff");
  if (ctx instanceof Response) return ctx;

  const docs = await kbDocsForOrg(ctx.orgId);
  return ok(
    docs.map((d) => ({
      id: d.id,
      category: d.category,
      title: d.title,
      source: d.source,
      edition: d.edition,
      status: d.status,
      pageCount: d.pageCount,
      hasFile: !!d.storageRef,
      uploadedAt: d.uploadedAt,
    })),
  );
}
