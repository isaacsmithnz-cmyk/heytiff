import { supabaseAdmin } from "@/lib/supabase-server";
import { DRAWING_HEADING_PREFIX } from "@/lib/tiff/drawings";
import { kbDocsForOrg, kbUploaderNames } from "@/lib/tiff/query";
import { editionWords } from "@/lib/tiff/released";
import { shelvesOf } from "@/lib/tiff/shelves";
import { kbTagsByDocument, kbTagsForOrg } from "@/lib/tiff/tags-query";
import { ok, requireMobile } from "@/lib/mobile/auth";

/* A LIBRARY DOCUMENT'S DETAILS for the phone's Details sheet (Isaac, 30
   October 2026: "can we see who added the items to the library? And when?
   is there like a details button or something that you can push on each
   one?"): what HeyTiff keeps about it, read only. Its brand and systems as
   its shelf says them, what kind it is, when it came out, its edition where
   that says more than the year, its pages and the drawings Tiff described,
   its file, and who added it when. Behind `tiff`, inside the caller's
   workspace; no storage reference. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "tiff");
  if (ctx instanceof Response) return ctx;

  const id = (await params).id.trim().slice(0, 80);
  const [docs, tagsOf, orgTags, names] = await Promise.all([kbDocsForOrg(ctx.orgId), kbTagsByDocument(ctx.orgId), kbTagsForOrg(ctx.orgId), kbUploaderNames(ctx.orgId)]);
  const d = docs.find((x) => x.id === id);
  if (!d) return Response.json({ error: "That document isn't in the Library any more." }, { status: 404, headers: { "cache-control": "no-store" } });

  const shelf = shelvesOf(docs, tagsOf, orgTags).get(d.id);
  /* A FIELD NOTE IS ITS WORDS: it has no file, so the phone's reader had
     nothing to show and only a search box (Isaac, 11 November 2026, on the
     Samsung VRF E603 note: "it didn't give me anything useful ... I wasn't
     actually able to view the information"). Its words come with it: where
     it was learned, and what it says. */
  const note = d.fileName
    ? null
    : await supabaseAdmin
        .from("kb_chunks")
        .select("heading, content")
        .eq("org_id", ctx.orgId)
        .eq("document_id", d.id)
        .order("chunk_index", { ascending: true })
        .limit(20)
        .then(({ data }) => {
          const parts = (data ?? []) as { heading: string | null; content: string | null }[];
          const body = parts.map((c) => c.content?.trim() ?? "").filter(Boolean).join("\n\n");
          return body ? { learned: parts[0]?.heading?.trim() || null, body } : null;
        });
  const { count } = await supabaseAdmin
    .from("kb_chunks")
    .select("id", { count: "exact", head: true })
    .eq("org_id", ctx.orgId)
    .eq("document_id", d.id)
    .like("heading", `${DRAWING_HEADING_PREFIX}%`);

  return ok({
    id: d.id,
    title: d.title,
    brand: shelf?.maker ?? null,
    systems: shelf?.maker ? shelf.systems : null,
    category: d.category,
    released: d.released ?? null,
    edition: editionWords(d.edition),
    status: d.status,
    pageCount: d.pageCount,
    scannedPages: d.scannedPages,
    drawings: count ?? 0,
    fileName: d.fileName,
    sizeBytes: d.sizeBytes,
    addedBy: d.uploadedById ? (names[d.uploadedById] ?? null) : null,
    addedAt: d.uploadedAt,
    note,
  });
}
