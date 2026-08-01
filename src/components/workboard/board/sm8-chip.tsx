"use client";

/* Mirror health, in one chip at the end of the tab row (D8's survival from
   the old board's vitals). It says one thing: can you trust what's on this
   card right now. Both boards carry it, because staleness is a fact about
   the DATA, not about maintenance; standalone orgs get no chip at all
   rather than a chip that says "not connected" on every screen forever.

   The account's clock hangs off the title — it matters when you're reading
   "synced 3 min ago" from a different timezone, and it doesn't earn a line. */

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
  if (!sm8) return null;
  return (
    <span
      className={"wb2-sm8" + (sm8.attention ? " dan" : "")}
      title={sm8.timezone ? `Account clock: ${sm8.timezone}` : undefined}
    >
      {sm8.attention
        ? "ServiceM8 needs attention"
        : sm8.running
          ? "ServiceM8 syncing…"
          : `ServiceM8 synced ${syncedAgo(sm8.syncedAt)}`}
    </span>
  );
}
