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

   NOT AFTER A RUN THAT STOPPED. A run ends early for the account's reasons
   — ServiceM8 unreachable, a limit, an unpaid bill, a grant to reconnect,
   Pause — and what it says about the account holds for the next file too.
   An unreachable ServiceM8 sets no hold on the rest of the queue, so a
   drain straight after would claim the next file, upload it into the same
   outage and spend its attempt. So a press whose own run stopped doesn't
   drain (the caller skips it), nor does a drain behind a run that stops;
   what waits goes on its own retry time, the next page load or the night.

   IT FITS IN THE FUNCTION. It runs in after(), inside the press's own
   function, so it claims only while a whole lease still fits before the
   function ends (backgroundBudgetMs, counted from `startedAt`); with no
   time left there is no drain, and the page loads and the nightly sweep
   take what is waiting. */

import { after } from "next/server";
import { backgroundBudgetMs } from "./sm8-write-plan";
import { runSm8Writes, sm8WritesEnabled, type Sm8WriteRun } from "./sm8-writes";

/** How long a note press (a reply, Send to ServiceM8, Undo, Mark done)
    waits on ServiceM8 before handing the rest to the queue. */
export const NOTE_PRESS_BUDGET_MS = 8_000;

/** How long a tick waits for its Done. The rest goes behind the answer. */
export const DONE_PRESS_BUDGET_MS = 3_000;

/** `p`'s answer, or null once `ms` have passed — whichever is first. The
    promise itself keeps going. */
export async function settleWithin<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([p.catch(() => null), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** A press's own rows, sent in the foreground for up to `budgetMs`, then —
    unless that run stopped for the account's reasons — the drain behind the
    answer, waiting for the press's run if it outlived the budget. The
    pattern job-sm8's Send to ServiceM8 follows, for every note press. */
export async function settlePressedWrites(
  orgId: string,
  ids: readonly string[],
  opts: { startedAt: number; budgetMs: number }
): Promise<void> {
  let running: Promise<Sm8WriteRun> | undefined;
  let stopped = false;
  if (ids.length > 0) {
    const pressRun = runSm8Writes(orgId, "send", { ids, budgetMs: opts.budgetMs });
    const run = await settleWithin(pressRun, opts.budgetMs);
    if (run === null) running = pressRun;
    else stopped = run.stopped !== null;
  }
  if (!stopped) drainSm8WritesAfterResponse(orgId, { startedAt: opts.startedAt, behind: running });
}

export function drainSm8WritesAfterResponse(
  orgId: string,
  opts: { startedAt?: number; behind?: Promise<Pick<Sm8WriteRun, "stopped">> } = {}
): void {
  if (!sm8WritesEnabled()) return;
  const startedAt = opts.startedAt ?? Date.now();
  /* caught now, not when the after() runs: a run that fails before then is
     no unhandled rejection */
  const behind = opts.behind?.catch(() => null);
  after(async () => {
    if (behind) {
      const ran = await behind;
      /* it stopped for the account's reasons: they hold for the next file */
      if (ran && ran.stopped !== null) return;
    }
    const budgetMs = backgroundBudgetMs(startedAt, Date.now());
    if (budgetMs <= 0) return;
    await runSm8Writes(orgId, "send", { budgetMs }).catch((err: unknown) => {
      console.error(`[sm8] the drain for org ${orgId} threw: ${err instanceof Error ? err.message : String(err)}`);
    });
  });
}
