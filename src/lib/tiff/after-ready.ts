import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { processScannedPages } from "./ocr-run";

/* ONCE A DOCUMENT IS READ, the drawings route (api/tiff/drawings, asked by
   ./ask-drawings) reads its drawings, and for a manual photographed on the
   phone, its pages first.

   A PHOTOGRAPHED MANUAL'S PAGES are all pictures, so ingestion finds no words
   on them and the document would sit half-read until someone pressed Read
   pages on the web. Photographing a manual to add it is asking for it to be
   read, so its pages are read with vision before its drawings (Isaac, 23
   November 2026, the mock's "Tiff reads it"). Only a manual the phone's Add
   made from the camera is marked so (kb_documents.pages_reading_until, which
   the Library shows as Reading until this clears it); a scanned PDF added
   from a file still waits for its Read pages, which is the spend's own
   choice. */

/** The most runs of the scanned-page read one photographed manual gets: 40 pages a run, 60 pages the most it can have. */
const RUNS_MOST = 2;

/** Is this a manual photographed on the phone whose pages are still to be
    read? The phone's Add marks it (lib/mobile/library-pages, pages_reading_until). */
async function photographed(documentId: string, orgId: string): Promise<{ marked: boolean; scanned: boolean }> {
  const { data } = await supabaseAdmin.from("kb_documents").select("scanned_pages, pages_reading_until").eq("org_id", orgId).eq("id", documentId).maybeSingle();
  const row = data as { scanned_pages: number | null; pages_reading_until: string | null } | null;
  return { marked: !!row?.pages_reading_until, scanned: Number(row?.scanned_pages) > 0 };
}

/** Its pages are read, or as read as they'll get: the Library stops saying Reading. */
const doneReading = (documentId: string, orgId: string) =>
  supabaseAdmin.from("kb_documents").update({ pages_reading_until: null }).eq("org_id", orgId).eq("id", documentId);

/** A photographed manual's pages, read with vision, before anything else. The caller holds the lease. Never throws. */
export async function readPhotographedPages(documentId: string, orgId: string, renew: () => Promise<void>): Promise<void> {
  let marked = false;
  try {
    const p = await photographed(documentId, orgId);
    marked = p.marked;
    if (!p.marked || !p.scanned) return;
    for (let run = 0; run < RUNS_MOST; run++) {
      const r = await processScannedPages(documentId, orgId);
      await renew().catch(() => undefined);
      if (r.status !== "ready" || r.scannedLeft === 0 || r.pagesRead === 0) {
        if (r.status !== "ready") console.warn(`[kb-pages] ${documentId}: pages ${r.status}${r.error ? `, ${r.error}` : ""}`);
        return;
      }
    }
  } catch (err) {
    console.error(`[kb-pages] ${documentId}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (marked) await Promise.resolve(doneReading(documentId, orgId)).catch(() => undefined);
  }
}
