/* Every press drains — server only.

   A press action that touches writing to ServiceM8 (Send to ServiceM8,
   Retry failed files, Sync now, switching sending on) ends by sending
   whatever is due for the workspace behind its answer. Before this, a file
   that met a busy ServiceM8 waited for the next time somebody happened to
   open the board; now the next press anywhere takes it. Every press action
   written later must call this too (sm8-writes' header says so).

   Its own module, beside the sender rather than in it, so the actions'
   tests run this for real against a stubbed sender.

   BEHIND A RUN STILL GOING. A press whose own send outlived its answer
   hands that run in as `behind`: nothing else keeps it alive once the
   answer has gone, and a drain beside it would find its rows claimed. The
   drain starts when it ends.

   IT FITS IN THE FUNCTION. It runs in after(), inside the press's own
   function, so it claims only while a whole lease still fits before the
   function ends (backgroundBudgetMs, counted from `startedAt`); with no
   time left there is no drain, and the page loads and the nightly sweep
   take what is waiting. */

import { after } from "next/server";
import { backgroundBudgetMs } from "./sm8-write-plan";
import { runSm8Writes, sm8WritesEnabled } from "./sm8-writes";

export function drainSm8WritesAfterResponse(
  orgId: string,
  opts: { startedAt?: number; behind?: Promise<unknown> } = {}
): void {
  if (!sm8WritesEnabled()) return;
  const startedAt = opts.startedAt ?? Date.now();
  /* caught now, not when the after() runs: a run that fails before then is
     no unhandled rejection */
  const behind = opts.behind?.catch(() => null);
  after(async () => {
    if (behind) await behind;
    const budgetMs = backgroundBudgetMs(startedAt, Date.now());
    if (budgetMs <= 0) return;
    await runSm8Writes(orgId, "send", { budgetMs }).catch((err: unknown) => {
      console.error(`[sm8] the drain for org ${orgId} threw: ${err instanceof Error ? err.message : String(err)}`);
    });
  });
}
