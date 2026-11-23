import { POST as readDocument } from "@/app/api/tiff/ingest/route";
import { actAsPhoneUser, requireMobile } from "@/lib/mobile/auth";
import { supabaseAdmin } from "@/lib/supabase-server";

/* Reading a manual, asked from the phone: the web's own ingest route, as the
   token's person, so the same claim, the same page allowance and the same
   drawings after. As from an open Library tab, a call starts the reading or
   takes over one that stopped, and answers where the document is up to.

   A READ DOCUMENT is answered from its row, not read again: the ingest route
   has nothing left to do on one but ask for its drawings over. And one
   photographed on the phone whose pages Tiff is still reading
   (kb_documents.pages_reading_until still ahead, lib/tiff/after-ready) says
   it is still being read, so many of its pages read, and the phone's
   keep-reading loop asks again until it's done. */

export const maxDuration = 300;

const json = (body: unknown) => Response.json(body, { headers: { "cache-control": "no-store" } });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "tiff_manage");
  if (ctx instanceof Response) return ctx;
  const documentId = (await params).id.trim().slice(0, 80);

  const { data } = await supabaseAdmin
    .from("kb_documents")
    .select("status, page_count, scanned_pages, chunk_count, pages_reading_until")
    .eq("org_id", ctx.orgId)
    .eq("id", documentId)
    .maybeSingle();
  const row = data as { status: string; page_count: number | null; scanned_pages: number | null; chunk_count: number | null; pages_reading_until: string | null } | null;
  if (row?.status === "ready") {
    const pageCount = row.page_count === null ? null : Number(row.page_count);
    const chunkCount = Number(row.chunk_count) || 0;
    const reading = !!row.pages_reading_until && Date.parse(row.pages_reading_until) > Date.now();
    if (!reading) return json({ status: "ready", pagesDone: pageCount ?? 0, pageCount, chunkCount });
    const unread = Number(row.scanned_pages) || 0;
    return json({ status: "processing", pagesDone: pageCount === null ? 0 : Math.max(0, pageCount - unread), pageCount, chunkCount });
  }

  return actAsPhoneUser(ctx, () =>
    readDocument(new Request(request.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ documentId }) })),
  );
}
