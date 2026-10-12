import { authorised } from "@/lib/integrations/cron-auth";
import { orgsWithDueSm8Writes, runSm8Writes } from "@/lib/integrations/sm8-writes";
import { WRITE_LEASE_MARGIN_MS } from "@/lib/integrations/sm8-write-plan";

/* THE QUEUE'S HEARTBEAT — what is due to go to ServiceM8, sent within the
   minute rather than at the next press.

   Every write is a row before it is a request (docs/migrations/
   sm8_writes.sql), and a row that met a busy ServiceM8 waits for its retry
   time. Until now nothing woke at that time: the next press anywhere took
   it, or the next page load, or the night (api/cron/sm8-sync). A file sent
   at 4:55 that met an outage could sit until morning if nobody opened the
   board again.

   This route only drains: it sends what is due, for the workspaces that
   have something due, inside its own time. No sync, no settling. Vercel's
   Hobby plan runs a cron once a day, so the minute comes from the database:
   pg_cron calls this with pg_net (docs/plans/queues.md has the SQL). Locked
   by CRON_SECRET exactly as the nightly route is, and it fails closed. */

export const maxDuration = 60;

/** Workspaces per call. The next minute takes the rest: the due list is
    ordered by how long each row has waited. */
const ORG_CAP = 10;

/** The whole call's sending time, leaving the last lease room to finish. */
const DRAIN_TOTAL_MS = maxDuration * 1000 - WRITE_LEASE_MARGIN_MS - 10_000;

/** One workspace's slice, so one loud account cannot take the minute. */
const DRAIN_ORG_MS = 15_000;

export async function GET(request: Request) {
  const startedAt = Date.now();
  if (!authorised(request.headers.get("authorization"))) {
    return Response.json({ error: "Not authorised." }, { status: 401 });
  }
  let sent = 0;
  let failed = 0;
  let deferred = 0;
  const orgs = await orgsWithDueSm8Writes(ORG_CAP);
  for (const orgId of orgs) {
    const left = startedAt + DRAIN_TOTAL_MS - Date.now();
    if (left <= 0) {
      deferred += 1;
      continue;
    }
    try {
      const run = await runSm8Writes(orgId, "cron", { budgetMs: Math.min(DRAIN_ORG_MS, left) });
      sent += run.sent;
      failed += run.failed;
    } catch {
      failed += 1;
    }
  }
  /* Counts only: no workspace, client or job leaves this route. */
  return Response.json({ workspaces: orgs.length, sent, failed, deferred });
}
