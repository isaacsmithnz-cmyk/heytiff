/* Mirror health: can you trust what's on this card right now. The job card
   says it beside its door back to ServiceM8.

   `syncedAgo` READS THE CLOCK, so render it only once the browser has one.
   The server produced "just now" and the client, a few seconds later across
   a minute boundary, produced "1 min ago" — different text in the same node,
   which is a hydration failure that took the whole tree's hydration with it.
   `suppressHydrationWarning` is not the fix: it keeps the SERVER's text until
   something else re-renders, a sentence lying about how fresh the mirror is.
   The server sends the half that cannot drift, and the browser finishes it. */

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
