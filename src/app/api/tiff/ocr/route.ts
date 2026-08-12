import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { claimDocument, releaseLease } from "@/lib/tiff/lease";
import { processScannedPages } from "@/lib/tiff/ocr-run";

/* Reading a document's scanned pages with vision, driven by the library row.

   A ROUTE HANDLER FOR THE SAME REASON THE INGEST ONE IS: forty pages of vision
   transcription is tens of seconds, and `maxDuration` is a route-segment
   option — an action would inherit the page's and raise the ceiling for every
   other action on the screen.

   ONE PRESS, ONE RUN. There is no loop here: `OCR_RUN_CAP` bounds what a click
   can spend, the answer says how many pages are still unread, and pressing
   again reads the next lot. That is deliberate — this is the OPTIONAL spend on
   top of ingestion, and a self-driving loop would make it not a choice.

   GATED `tiff_manage`, like ingestion. Reading the library is the staff tier;
   spending the org's page allowance is not, and a route handler is reachable
   directly. */

export const maxDuration = 300;

export async function POST(request: Request) {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!session || !orgId) return Response.json({ error: "Not signed in." }, { status: 401 });
  if (!(await can("tiff_manage"))) {
    return Response.json(
      { error: "You don't have access to manage the library." },
      { status: 403 }
    );
  }

  let documentId: string;
  try {
    const body = (await request.json()) as { documentId?: unknown };
    if (typeof body?.documentId !== "string" || !body.documentId.trim()) {
      return Response.json({ error: "No document to read." }, { status: 400 });
    }
    documentId = body.documentId.trim();
  } catch {
    return Response.json({ error: "That request couldn't be read." }, { status: 400 });
  }

  /* THE SAME CLAIM INGESTION TAKES, for the same reason: this writes chunks,
     and two tabs pressing the button together would write them twice. It is
     the one shared lease, so a run can also never overlap an ingest batch on
     the same document. */
  if (!(await claimDocument(documentId, orgId))) {
    return Response.json({
      status: "failed",
      pagesRead: 0,
      scannedLeft: 0,
      chunkCount: 0,
      error: "That document is busy — try again in a moment.",
    });
  }

  try {
    /* 200 even for a run that failed: the CALL worked, and the row's job is to
       render the outcome rather than to retry a 500. */
    return Response.json(await processScannedPages(documentId, orgId));
  } finally {
    await releaseLease(documentId, orgId);
  }
}
