import { kbDocsForOrg } from "@/lib/tiff/query";
import { kbTagsByDocument, kbTagsForOrg } from "@/lib/tiff/tags-query";
import { shelvesOf } from "@/lib/tiff/shelves";
import { ok, requireMobile } from "@/lib/mobile/auth";

/* THE LIBRARY'S DOCUMENTS for the phone's shelves, newest first, as the
   Library page lists them (kbDocsForOrg: confirmed uploads only), behind the
   same `tiff` grant. Only what a shelf row says: no storage reference, so a
   file is opened through /library/[id]/file, signed on demand, never from a
   list. Each says its cover and its shelf too, read off its Manufacturer and
   System tags and its title (lib/tiff/shelves; Isaac, 30 October 2026, the
   Library's second go). */
export async function GET(request: Request) {
  const ctx = await requireMobile(request, "tiff");
  if (ctx instanceof Response) return ctx;

  const [docs, tagsOf, orgTags] = await Promise.all([kbDocsForOrg(ctx.orgId), kbTagsByDocument(ctx.orgId), kbTagsForOrg(ctx.orgId)]);
  const shelving = shelvesOf(docs, tagsOf, orgTags);
  return ok(
    docs.map((d) => {
      const s = shelving.get(d.id);
      return {
        id: d.id,
        category: d.category,
        title: d.title,
        source: d.source,
        edition: d.edition,
        status: d.status,
        pageCount: d.pageCount,
        hasFile: !!d.storageRef,
        uploadedAt: d.uploadedAt,
        /* the year it came out, on its cover (lib/tiff/released) */
        year: d.released ? Number(d.released.slice(0, 4)) : null,
        ...(s ? { shelf: s.shelf, shelfName: s.shelfName, systems: s.systems, maker: s.maker, color: s.color, cover: s.name } : {}),
      };
    }),
  );
}
