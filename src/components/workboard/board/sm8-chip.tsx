"use client";

import { useHydrated } from "@/lib/use-hydrated";

/* Mirror health, in one chip at the end of the tab row (D8's survival from
   the old board's vitals). It says one thing: can you trust what's on this
   card right now. Both boards carry it, because staleness is a fact about
   the DATA, not about maintenance; standalone orgs get no chip at all
   rather than a chip that says "not connected" on every screen forever.

   The account's clock hangs off the title — it matters when you're reading
   "synced 3 min ago" from a different timezone, and it doesn't earn a line.

   THE TIME IS ONLY RENDERED ONCE THE BROWSER HAS IT. `syncedAgo` reads
   `Date.now()`, so the server produced "just now" and the client, a few
   seconds later across a minute boundary, produced "1 min ago" — different
   text in the same node, which is a hydration failure. It threw on every
   workboard load and took the whole tree's hydration with it.

   The fix is not `suppressHydrationWarning`: that hides the error and keeps
   the SERVER's text until something else happens to re-render, so the chip
   would sit there lying about how fresh the mirror is. Rendering the clock
   only on the client is the honest version — the server sends the half of
   the sentence that cannot drift, and the browser finishes it. */

export type Sm8Health = {
  attention: boolean;
  syncedAt: string | null;
  running: boolean;
  timezone?: string | null;
};

export function syncedAgo(iso: string | null): string {
  if (!iso) return "not yet";
  const mins = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (Number.isNaN(mins) || mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return "over a day ago";
}

export function Sm8Chip({ sm8 }: { sm8: Sm8Health | null | undefined }) {
  const hydrated = useHydrated();
  if (!sm8) return null;

  /* Only this branch reads the clock. "needs attention" and "syncing…" are
     facts about the mirror, identical on both sides, and stay server-rendered. */
  /* THE ROUTINE STATE DROPS THE NAME. This stands in the board's header,
     beside six tabs that ARE ServiceM8's own statuses and under a switcher
     that says which half of the mirror you are reading — so "ServiceM8
     synced 5 min ago" said the word a fourth time, and it was the widest
     thing in a band that has to hold a title, six tabs, a switcher, a search
     and Display mode on one line.

     The two EXCEPTIONAL states keep it: "needs attention" and "syncing" have
     to name what needs attention and what is syncing, and they are rare
     enough to be allowed the width. */
  const freshness = sm8.attention
    ? "ServiceM8 needs attention"
    : sm8.running
      ? "ServiceM8 syncing…"
      : hydrated
        ? `Synced ${syncedAgo(sm8.syncedAt)}`
        : "Synced";

  return (
    <span
      className={"wb2-sm8" + (sm8.attention ? " dan" : "")}
      title={sm8.timezone ? `Account clock: ${sm8.timezone}` : undefined}
    >
      {freshness}
    </span>
  );
}
