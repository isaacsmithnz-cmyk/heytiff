import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { processBatch } from "@/lib/tiff/ingest";

/* One batch of ingestion, driven by the library page.

   A ROUTE HANDLER RATHER THAN A SERVER FUNCTION, for the same reason the
   transcribe route is one: this call is LONG. Reading, chunking, tagging and
   embedding twenty pages of a manual takes tens of seconds, and `maxDuration`
   is a route-segment option — an action inherits the page's, so raising it for
   ingestion would raise it for every action on the screen. The sm8-sync cron
   sets the same ceiling for the same reason.

   THE LOOP LIVES IN THE BROWSER. There is no queue (Vercel Hobby allows one
   cron a day), so the library calls this, reads the progress, and calls again
   until the document is ready, paused or failed. Each call is idempotent-ish
   by construction: the bookmark only moves when a batch's chunks are stored,
   so a call that dies mid-flight costs the batch, not the document.

   GATED `tiff_manage`, not `tiff`. Reading and asking is the staff tier;
   spending the org's monthly page allowance is not — and a route handler is
   reachable directly, so the gate is here rather than only on the screen that
   posts to it. */

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
      return Response.json({ error: "No document to process." }, { status: 400 });
    }
    documentId = body.documentId.trim();
  } catch {
    return Response.json({ error: "That request couldn't be read." }, { status: 400 });
  }

  /* processBatch never throws: a failure lands on the row as `failed` plus a
     reason, and comes back here as progress. So the response is 200 even for a
     document that failed — the CALL worked, and the caller's job is to render
     the state, not to retry a 500. */
  const progress = await processBatch(documentId, orgId);
  return Response.json(progress);
}
