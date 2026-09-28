/* The sync lease's rules — pure (two-way phase 4, PR B).

   One lease guards a workspace's ServiceM8 mirror: sm8_sync_runs.lease_until,
   claimed conditionally, so only one writer walks it at a time. Three kinds
   of holder take it: the sync, the callback's change of account (`switch`),
   and, later, the webhook drain (`hook`). This module holds what each of
   them decides and how long it may go on; sm8-sync.ts carries it out
   against the database. Nothing here reads or writes anything, so the
   callers that only wait (the page-load kick, Sync now, the nightly run)
   import it without importing the database.

   THE THREE RULES, for every holder:
   - A LEASE IS HELD BY TOKEN. Claiming stamps a fresh lease_token beside
     lease_until, and every later write about the lease (extend, release)
     matches BOTH: `where lease_token = mine and lease_until = mine`. A holder
     that outlived its lease can then never clear or extend the next
     holder's — not even in the moment between that holder's claim and its
     stamp, when the row still carries the stale token.
   - A HOLDER STOPS BEFORE ITS LEASE RUNS OUT. Before each page the sync
     checks that a whole page's worst case still fits in what is left; when
     it doesn't, it extends by token, and only while the whole new lease
     still ends inside its function. Otherwise it stops, and the next sync
     carries on from the page it didn't read. An extension that matches
     nothing means another holder has the lease: the sync writes nothing
     more, not even its own bookkeeping.
   - A SYNC THAT MEETS THE LEASE HELD SAYS SO. It stamps wanted_at, so a
     drain holding the lease stands aside within one read, and it tries
     again a few times (whenSm8LeaseFree) rather than giving up at once. Its
     claim clears the want.

   A DATABASE WITHOUT THE COLUMNS (sm8_webhooks.sql not yet applied) holds
   the lease exactly as before this PR: no token, an unconditional release,
   no extension. sm8-sync.ts says so once in the log. */

/** Who holds the lease. */
export type Sm8LeaseBy = "sync" | "switch" | "hook";

/** The lease is held elsewhere: another run is walking. */
export const SM8_SYNC_BUSY = "A sync is already running.";

/** A sync whose lease was taken over mid-walk (its extension matched
    nothing). Nothing more of it was written, so nothing records this: it is
    only the answer to whoever started the run. */
export const SM8_LEASE_LOST = "Another run took over the sync; it carries on from there.";

/** How long the sync holds the lease at a time. */
export const SYNC_LEASE_MS = 120_000;

/** One page's read: sm8-read's own timeout (HTTP_TIMEOUT_MS)... */
export const SYNC_READ_TIMEOUT_MS = 10_000;
/** ...and the longest the meter keeps the `sync` lane waiting for a turn
    (sm8-meter's SM8_METER.maxWaitMs.sync is this number). */
export const SYNC_METER_WAIT_MS = 3_000;
/** A refused token is renewed once and the page read again (sm8-renew):
    the refresh's claim on the connection (sm8-store's REFRESH_CLAIM_MS). */
export const SYNC_RENEW_MS = 15_000;
/** Storing the page, checking the account, saving where the walk got to and
    giving the lease back — everything the sync writes after a read. */
export const SYNC_WRITE_MARGIN_MS = 10_000;

/** What one page needs to finish inside the lease, at worst: a read, a
    renewal, the read again, and the writes after it. 51 s. */
export const SYNC_PAGE_NEED_MS = 2 * (SYNC_READ_TIMEOUT_MS + SYNC_METER_WAIT_MS) + SYNC_RENEW_MS + SYNC_WRITE_MARGIN_MS;

/** How the sync goes on before its next page:
    - `go`: a whole page still fits in the lease and in the function;
    - `extend`: it doesn't fit the lease, but a whole new lease still ends by
      the deadline, so extend by token first;
    - `stop`: neither — pause here, and the next sync resumes. */
export type Sm8PageStep = "go" | "extend" | "stop";

export function syncPageStep(input: { now: number; leaseUntil: number; deadline: number }): Sm8PageStep {
  const { now, leaseUntil, deadline } = input;
  if (now + SYNC_PAGE_NEED_MS > deadline) return "stop";
  if (leaseUntil - now >= SYNC_PAGE_NEED_MS) return "go";
  return now + SYNC_LEASE_MS <= deadline ? "extend" : "stop";
}

/** Whether a live lease is a SYNC's, for the owner's "running" line. A
    lease without a holder named is one claimed the old way (a database
    without lease_by, or a claim from before this PR): that is a sync, as it
    always was. */
export function sm8LeaseIsSyncs(by: string | null | undefined): boolean {
  return by == null || by === "sync";
}

/** Whether a live lease puts off the page-load kick. Only a drain's does
    not: a kick that meets one asks for the lease (wanted_at) and the drain
    stands aside, where skipping the kick would leave the mirror waiting on
    the drain. Every other holder puts it off, as every lease always has. */
export function sm8LeaseDefersKick(by: string | null | undefined): boolean {
  return by !== "hook";
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Run `run` (a sync) until it isn't busy: at most `tries` times, `waitMs`
    apart, and never starting a try past `startBy` (an absolute time, the
    last moment a whole lease still fits the caller's function). The last
    answer is the answer, busy or not. Each busy try has already asked for
    the lease (wanted_at), so a drain holding it stands aside meanwhile. */
export async function whenSm8LeaseFree<T extends { ran: boolean; note: string }>(
  run: () => Promise<T>,
  opts: { tries?: number; waitMs?: number; startBy?: number } = {}
): Promise<T> {
  const tries = opts.tries ?? 6;
  const waitMs = opts.waitMs ?? 2_000;
  for (let i = 1; ; i++) {
    const out = await run();
    if (out.ran || out.note !== SM8_SYNC_BUSY || i >= tries) return out;
    if (opts.startBy !== undefined && Date.now() + waitMs > opts.startBy) return out;
    await sleep(waitMs);
  }
}
