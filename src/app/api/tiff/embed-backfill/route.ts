import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { backfillBatch } from "@/lib/tiff/backfill";

/* One batch of embedding backfill, driven by the library page.

   A ROUTE HANDLER RATHER THAN A SERVER FUNCTION, for the same reason ingestion
   is one: this call is LONG. Sixty-four passages is a Voyage request plus
   sixty-four writes, and `maxDuration` is a route-segment option — an action
   inherits the page's, so raising it for the backfill would raise it for every
   action on the library screen.

   THE LOOP LIVES IN THE BROWSER. There is no queue (Vercel Hobby allows one
   cron a day), so the library calls this, reads what is left, and calls again
   until nothing is left or the batch says it stopped. Each call is
   self-contained: it reads whatever is still null, so a call that dies
   mid-flight costs that batch and nothing else.

   GATED `tiff_manage`, not `tiff`. Reading and asking is the staff tier;
   spending the org's Voyage requests is not — and a route handler is reachable
   directly, so the gate is here rather than only on the screen that posts to
   it. */

export const maxDuration = 300;

export async function POST() {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!session || !orgId) return Response.json({ error: "Not signed in." }, { status: 401 });
  if (!(await can("tiff_manage"))) {
    return Response.json(
      { error: "You don't have access to manage the library." },
      { status: 403 }
    );
  }

  /* backfillBatch reports its own failures as a `stopped` reason, so a 200
     with a reason is the normal shape here — the CALL worked, and the caller's
     job is to render what it says rather than retry a 500. The catch is for
     the client itself blowing up, which would otherwise reach the browser as
     an opaque 500 the loop has nothing to say about. */
  try {
    return Response.json(await backfillBatch(orgId));
  } catch (err) {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? "unknown");
    console.error(`[kb-backfill] batch failed for ${orgId} — ${detail}`);
    return Response.json({ done: 0, remaining: 0, stopped: "failed" });
  }
}
