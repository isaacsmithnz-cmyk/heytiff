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
    way: a screen asks for its read, and again each PLAN_ASK_AGAIN_MS while
    it stays reading. Past the read route's five minutes, so a read still
    going isn't asked for again. */
export const PLAN_STUCK_MS = 6 * 60_000;

/** A stuck plan is asked for again at most this often while its job stays
    open: a read's claim lasts ten minutes (plans-server.ts claimRead), so an
    ask inside it is turned away by the read that holds it, and one past it
    picks up a read whose hand-on to the next run was lost. */
export const PLAN_ASK_AGAIN_MS = 10 * 60_000;

/** The plans a screen asks the read route for again: still reading
    PLAN_STUCK_MS after they were added, and not asked for by this screen
    (`asked`, when it last did) in the last PLAN_ASK_AGAIN_MS. */
export function plansToAskAgain(plans: readonly { id: string; state: string; addedAt: string }[], asked: ReadonlyMap<string, number>, now: number): string[] {
  return plans.filter((p) => p.state === "reading" && now - new Date(p.addedAt).getTime() > PLAN_STUCK_MS && now - (asked.get(p.id) ?? -Infinity) > PLAN_ASK_AGAIN_MS).map((p) => p.id);
}

/** How long after a plan's read its job's scope is waited on: the read
    route writes the scope after it, in a minute or two. */
export const SCOPE_FROM_PLANS_MS = 5 * 60_000;
