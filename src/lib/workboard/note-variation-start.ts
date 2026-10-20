/* A VARIATION FROM A NOTE, STARTED — server only.

   The router's variations lane (note-variation) ends here: whether the
   job's quote has an accepted option to vary, and the variation itself,
   started through the quote page's own `startVariation` (lines-job-server):
   the accepted option copied to a new one, every line kept in the quote's
   history as a copy, named Variation N, with the client's words as what's
   changing. Nothing here prices, approves or sends it. `dropVariation` is
   its Undo, and only while it is still that empty copy.

   WHICH WAY, in order (v2 step 6, slice D):
     no accepted quote  a note off a ServiceM8 job, or a job whose quote has
                        nothing accepted: no variation, a task to change the
                        quote, and Tiff says so;
     no money access    the quote page's own gate on Start a variation
                        (MONEY_OPS): a task for the speaker, and she says why;
     start              the variation's draft. */

import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { readByHand, startVariation } from "@/lib/quotes/lines-job-server";
import { addEvents, readSession } from "@/lib/quotes/session/store-server";
import type { NoteTarget } from "@/app/actions/workboard-notes";
import type { VariationWhy } from "./note-variation";

export type VariationRoute = { kind: "start"; jobUuid: string } | { kind: "task"; why: VariationWhy; jobUuid: string | null };

/** Which way a variation goes: `money` is whether the speaker has the
    quote page's money access. The job is the card a claim's own job opens
    (its parent), where the quote lives. */
export async function variationRoute(orgId: string, target: NoteTarget, money: boolean): Promise<VariationRoute> {
  const id = target.kind === "job" && target.id ? target.id : null;
  if (!id) return { kind: "task", why: "unaccepted", jobUuid: null };
  const jobUuid = (await resolveJobCard(orgId, id)).parentRemoteId;
  const byHand = await readByHand(orgId, jobUuid);
  if (byHand.accepted.length === 0) return { kind: "task", why: "unaccepted", jobUuid };
  if (!money) return { kind: "task", why: "money", jobUuid };
  return { kind: "start", jobUuid };
}

/** START ONE, through the quote page's own action. */
export async function startNoteVariation(
  orgId: string,
  jobUuid: string,
  what: string,
  by: string,
): Promise<{ ok: true; option: number; n: number } | { ok: false; error: string }> {
  const r = await startVariation(orgId, jobUuid, what, by);
  if (!r.ok) return { ok: false, error: r.reason };
  /* the quote's history, in Tiff's thread where there is one, as the quote
     page marks it (slice 6.2) */
  try {
    const session = await readSession(orgId, jobUuid);
    if (session) {
      await addEvents(orgId, session.id, null, [{ kind: "milestone", author: by, body: { text: `Variation ${r.n} started${what.trim() ? `: ${what.trim().slice(0, 200)}` : ""}` } }]);
    }
  } catch {
    /* the history is a courtesy: the variation stands without it */
  }
  return r;
}
