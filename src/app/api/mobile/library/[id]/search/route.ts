import { searchKbDocument } from "@/lib/tiff/query";
import { MAX_DOC_HITS, isSearchable, normaliseQuery, searchTerms, snippetOf } from "@/lib/tiff/doc-search";
import { ok, requireMobile } from "@/lib/mobile/auth";

/* FINDING A WORD INSIDE ONE DOCUMENT from the phone, exactly as the
   Library's own box does it (actions/kb's searchKbDoc), behind `tiff`: the
   full-text index every chunk already carries, so no model and no allowance;
   hits in page order, each a snippet with its matches marked, one more asked
   for than shown to know whether to say the list was cut. The document is
   only ever searched inside the caller's own workspace. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "tiff");
  if (ctx instanceof Response) return ctx;

  const id = (await params).id.trim().slice(0, 80);
  const q = new URL(request.url).searchParams.get("q") ?? "";
  if (!id || !isSearchable(q)) return ok({ hits: [], capped: false });

  const rows = await searchKbDocument(ctx.orgId, id, normaliseQuery(q), MAX_DOC_HITS + 1);
  const terms = searchTerms(q);
  return ok({
    capped: rows.length > MAX_DOC_HITS,
    hits: rows.slice(0, MAX_DOC_HITS).map((row) => ({
      chunkId: row.chunkId,
      pageFrom: row.pageFrom,
      pageTo: row.pageTo,
      heading: row.heading,
      segments: snippetOf(row.content, terms),
    })),
  });
}
