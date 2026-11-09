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
export const PLAN_POLL_MS = 8_000;
