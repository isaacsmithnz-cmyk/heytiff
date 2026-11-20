/* The browser's side of a plan's read: asking the route to read each plan
   just added (api/jobs/plans/read), without waiting on the answer. The row
   is written on the server as the read goes, and the screen polls the job's
   plans while one says "reading" (readPlansOnJob). Pure in effect: a fetch
   that is let go. */
export function kickPlanReads(planIds: readonly string[]): void {
  for (const planId of planIds) {
    void fetch("/api/jobs/plans/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ planId }),
      keepalive: true,
    }).catch(() => {});
  }
}

/** How often a screen asks after a plan being read. */
export const PLAN_POLL_MS = 4_000;

/** A plan still "reading" this long after it was added was dropped on the
    way: a screen asks for its read once more. Past the read route's five
    minutes, so a read still going isn't asked for again. */
export const PLAN_STUCK_MS = 6 * 60_000;
