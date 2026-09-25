import "server-only";

/* A PRESS: the proof that a PERSON asked for a write to ServiceM8, now.

   Every write HeyTiff makes to somebody's ServiceM8 starts with somebody
   pressing a button, and this is how the queue knows it did. A press is
   minted here, from the signed-in session and nothing else, and the queue
   (sm8-writes' enqueueSm8Writes) refuses anything that isn't one:

   - IT CAN'T BE BUILT FROM A BARE ORG ID. The brand is a WeakSet of the
     objects minted here, so an object literal with the same fields, or an
     `as Sm8Press` cast, fails the check at run time as well as the type
     check.
   - IT GOES STALE. A press older than SM8_PRESS_MAX_AGE_MS is refused, so
     one can't be kept in a closure and spent later from a timer, a kick or a
     cron. A background sender SENDS what a press queued; it never queues.
   - The brand lives in this process, so code that holds a session could
     still mint one. The import-boundary test (sm8-press.test.ts) is what
     keeps minting to the "use server" actions, where a press is a press. */

import { auth0 } from "@/lib/auth0";
import { staffProfileIdFor } from "@/lib/fleet/query";

declare const PRESS: unique symbol;

export type Sm8Press = Readonly<{
  orgId: string;
  /** The Auth0 user who pressed — requested_by_user on the row. */
  userId: string;
  /** Their staff card, when they have one — requested_by on the row. */
  staffId: string | null;
  /** When it was minted. */
  at: number;
}> & { readonly [PRESS]: true };

/** How long a press stays good: a press's own foreground work, with room. */
export const SM8_PRESS_MAX_AGE_MS = 120_000;

const minted = new WeakSet<object>();

/** The press of whoever is signed in, now. Null without a session. */
export async function sm8PressFromSession(): Promise<Sm8Press | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return null;
  const staffId = await staffProfileIdFor(orgId, userId).catch(() => null);
  const press = Object.freeze({ orgId, userId, staffId: staffId ?? null, at: Date.now() });
  minted.add(press);
  return press as unknown as Sm8Press;
}

/** Whether `p` is a press minted here, and still fresh at `now`. */
export function isSm8Press(p: unknown, now: number = Date.now()): p is Sm8Press {
  if (!p || typeof p !== "object" || !minted.has(p)) return false;
  const age = now - (p as { at: number }).at;
  return age >= 0 && age < SM8_PRESS_MAX_AGE_MS;
}
