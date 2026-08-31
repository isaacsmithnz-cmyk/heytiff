"use client";

import Link from "next/link";
import { Icon } from "@/components/shell/icon";

/* WHY AN EMPTY BOARD SAYS WHAT IT SAYS.

   All jobs is the UNION — ServiceM8's book of work plus the visits and
   projects tracked natively (see all-jobs-board's `view`). That makes its
   emptiness the whole board's emptiness: nothing here means nothing on the
   other two sides either, because they are its subsets. So the one place
   worth explaining the gap is the empty list itself, and the explanation has
   to survive being read by somebody who has never connected anything.

   THE THREE STATES ARE NOT ONE STATE. "Empty" alone can't choose the words:

   - not connected      → there is an action to take, and a link to take it
   - connected, syncing → the first backfill is still walking the account;
                          telling this person to "connect ServiceM8" is
                          telling them to do what they just did
   - connected, done    → genuinely no work, which is the caller's own copy

   The middle one is the reason `syncing` is threaded down at all. A fresh
   grant reads empty for minutes while `jobs` backfills, and only
   `backfill_done` distinguishes "nothing yet" from "nothing" — a row count
   can't, because zero is what both look like.

   NOT GATED ON `connection === "attention"`. A grant that needs re-auth still
   has a full mirror behind it; that board is not empty and never reaches
   here. */

export type Sm8GapKind = "connect" | "syncing";

/** Which gap, if any, explains an empty list. `null` means the emptiness is
    real and the caller should say what it means on its own surface. */
export function sm8Gap({
  connected,
  syncing,
}: {
  connected: boolean;
  syncing: boolean;
}): Sm8GapKind | null {
  if (!connected) return "connect";
  if (syncing) return "syncing";
  return null;
}

const COPY: Record<Sm8GapKind, Record<"jobs" | "diary", { head: string; body: string }>> = {
  connect: {
    jobs: {
      head: "No work to show yet",
      body: "Connect ServiceM8 and the account's whole book of work lands here — service calls, installs and quotes.",
    },
    diary: {
      head: "The diary lives in ServiceM8",
      body: "Connect it and every dispatched booking lands here, laid out by person and day.",
    },
  },
  syncing: {
    jobs: {
      head: "Still bringing the jobs across",
      body: "The first sync is walking the account. This fills in as it goes.",
    },
    diary: {
      head: "Still bringing the diary across",
      body: "The first sync is walking the account's bookings. The days fill in as it goes.",
    },
  },
};

const HREF = "/dashboard/admin/integrations/servicem8";

export function Sm8Gap({
  kind,
  surface,
  manage,
}: {
  kind: Sm8GapKind;
  surface: "jobs" | "diary";
  /* The link is for whoever can actually follow it. A tech has no integrations
     screen to land on, so they get the explanation without a door that closes
     in their face — the same split the page's standalone stamp used to make. */
  manage: boolean;
}) {
  const copy = COPY[kind][surface];
  return (
    <div className="wb2-empty">
      <Icon name={kind === "connect" ? "plug" : "sync"} size={20} />
      <b>{copy.head}</b>
      <em className="wb2-emptybody">{copy.body}</em>
      {kind === "connect" && manage && (
        <Link href={HREF} className="ro-link wb2-emptylink">
          Connect ServiceM8
        </Link>
      )}
    </div>
  );
}
