import { after } from "next/server";
import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { claimDocument, releaseLease } from "@/lib/tiff/lease";
import { DRIVE_BUDGET_MS, driveDocument, processBatch, readProgress } from "@/lib/tiff/ingest";

/* Ingestion, driven from here rather than from the tab.

   A ROUTE HANDLER RATHER THAN A SERVER FUNCTION, for the same reason the
   transcribe route is one: this call is LONG. `maxDuration` is a route-segment
   option — an action inherits the page's, so raising it for ingestion would
   raise it for every action on the screen.

   THE REQUEST THAT STARTS THE WORK NOW FINISHES IT. It used to do exactly one
   batch and hand the browser the job of asking again, which meant closing the
   tab stranded a document mid-read — one manual sat on page 21 of 32 for
   sixty-three minutes waiting for somebody to open the library. `after` runs
   the rest of the document once the response has gone, for as long as the
   invocation is allowed to live, so the tab only decides whether anybody is
   WATCHING.

   ONE BATCH BEFORE THE ANSWER, the rest behind it. The caller gets real
   movement to render rather than an empty "started", and the loop that keeps
   asking still sees its progress advance.

   THE CLAIM IS WHAT MAKES IT SAFE. Every open tab drives this, and without an
   owner two of them read the same bookmark and insert the same chunks — 122 of
   prod's 2,256 chunks were byte-identical duplicates before this existed. A
   caller who doesn't get the claim is told what the row says and nothing is
   processed twice.

   GATED `tiff_manage`, not `tiff`. Reading and asking is the staff tier;
   spending the org's monthly page allowance is not — and a route handler is
   reachable directly, so the gate is here rather than only on the screen. */

export const maxDuration = 300;

export async function POST(request: Request) {
  const started = Date.now();
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

  /* Somebody else owns it — another tab, or this invocation's own predecessor
     still working through the document in the background. Not an error, and
     not a reason to render nothing: the row's own state is the answer. */
  if (!(await claimDocument(documentId, orgId))) {
    return Response.json({ ...(await readProgress(documentId, orgId)), busy: true });
  }

  /* processBatch never throws: a failure lands on the row as `failed` plus a
     reason and comes back here as progress. So the response is 200 even for a
     document that failed — the CALL worked, and the caller's job is to render
     the state, not to retry a 500. */
  const first = await processBatch(documentId, orgId);

  if (first.status !== "processing") {
    await releaseLease(documentId, orgId);
    return Response.json(first);
  }

  /* The budget is what is LEFT of the invocation, not a fresh one: the batch
     above already spent part of it, and `after` shares this invocation's
     `maxDuration` rather than getting its own. */
  const remaining = DRIVE_BUDGET_MS - (Date.now() - started);
  after(async () => {
    try {
      await driveDocument(documentId, orgId, remaining);
    } finally {
      // handed back rather than left to expire, so the next caller can start
      await releaseLease(documentId, orgId);
    }
  });

  return Response.json({ ...first, continuing: true });
}
