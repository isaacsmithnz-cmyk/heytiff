/* One request to ServiceM8, renewed once when its token is refused — server
   only.

   A 401 used to be read as "the grant is dead", flagged, and the connection
   asked to be reconnected. But a 401 is often only a token that ran out
   between being handed over and being used — the hourly token expiring mid
   sync — or one a sibling server has since rotated past. So a refused call
   gets exactly ONE renewal and one more try, and only a second refusal,
   under a token the store has just vouched for, flags the grant. The flag is
   for that grant only (markSm8NeedsReauth), so a slow call can't flag a
   reconnect that landed while it was out.

   Its own module, beside the store rather than in it, so the suites that
   replace the store with a fake still run this for real: the sync engine,
   the sender and the reader all use it, and each one's tests prove its own
   401 path through it. */

import { markSm8NeedsReauth, renewSm8Access, type Sm8Access } from "./sm8-store";
import { SM8_REVOKED } from "./sm8-sync-plan";

/** How the call ended, as far as the grant goes:
    - `ok`: the result wasn't refused (on the first try or the second);
    - `dead`: refused twice, a token apart, and the grant is flagged — or the
      renewal itself found it dead, which flagged it;
    - `unreachable`: the renewal couldn't reach ServiceM8. Nothing flagged;
    - `gone`: there is no connection any more;
    - `late`: renewed, but there was no time left to try again (see `retry`).
      The new token comes back in `access` for the next call. */
export type RenewVerdict = "ok" | "dead" | "unreachable" | "gone" | "late";

export type Renewed<T> = {
  /** The last answer the call gave — the refused one, when no second try ran. */
  result: T;
  /** The access to carry on with: the renewed one, once there is one. */
  access: Sm8Access;
  /** How many requests reached ServiceM8, for a caller counting its calls. */
  tries: 1 | 2;
  verdict: RenewVerdict;
};

/** Run `call` with `access`; if `refused` says its answer was a 401, renew
    the token once and run it again. At most one renewal per call.

    `retry`, when given, is asked after the renewal whether a second request
    still fits — the sender holds a claim on its row for a bounded time, and a
    second upload that could outlast it is left for the next run instead. */
export async function withSm8Renewal<T>(
  orgId: string,
  access: Sm8Access,
  call: (access: Sm8Access) => Promise<T>,
  refused: (result: T) => boolean,
  opts: { retry?: () => boolean } = {}
): Promise<Renewed<T>> {
  const first = await call(access);
  if (!refused(first)) return { result: first, access, tries: 1, verdict: "ok" };

  const renewed = await renewSm8Access(orgId, access);
  if (!renewed.ok) {
    const verdict: RenewVerdict =
      renewed.reason === "reauth" ? "dead" : renewed.reason === "unreachable" ? "unreachable" : "gone";
    return { result: first, access, tries: 1, verdict };
  }
  if (opts.retry && !opts.retry()) {
    return { result: first, access: renewed.access, tries: 1, verdict: "late" };
  }

  const second = await call(renewed.access);
  if (!refused(second)) return { result: second, access: renewed.access, tries: 2, verdict: "ok" };

  await markSm8NeedsReauth(orgId, SM8_REVOKED, renewed.access);
  return { result: second, access: renewed.access, tries: 2, verdict: "dead" };
}
