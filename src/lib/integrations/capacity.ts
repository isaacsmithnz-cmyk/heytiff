/* How much room is left before Xero stops letting customers connect — pure.

   WHY THIS EXISTS AT ALL: Xero caps CONNECTIONS by app tier, and gives no
   warning as you approach the ceiling. Customer number six simply fails to
   connect, and on our side that surfaces as the generic "Xero didn't complete
   the connection" — a message that describes nothing about the real cause and
   sends whoever reads it hunting through their own credentials.

   The count that matters is one row per connected organisation in
   integration_connections, which we already have. So the ceiling is knowable
   here, and the whole point is to see it coming rather than discover it.

   Tiers, from developer.xero.com/documentation/guides/oauth2/limits (March 2026
   commercial model). Moving up is a commercial conversation with Xero, not a
   code change — which is exactly why the warning needs lead time. */

export type XeroTier = "starter" | "core" | "plus";

/** Connection ceilings per tier. `plus` is where App Store listing begins and
    Xero negotiates the number, so it is recorded as unbounded here rather than
    guessed at. */
export const XERO_TIER_LIMITS: Record<XeroTier, number | null> = {
  starter: 5,
  core: 50,
  plus: null,
};

/** New apps land on starter. This is the honest default until someone
    deliberately records otherwise. */
export const DEFAULT_TIER: XeroTier = "starter";

export type Capacity = {
  used: number;
  limit: number | null;
  /** null when the tier is unbounded. */
  remaining: number | null;
  /** Worth saying out loud: one or none left, or already full. */
  tight: boolean;
  full: boolean;
};

export function xeroCapacity(used: number, tier: XeroTier = DEFAULT_TIER): Capacity {
  const limit = XERO_TIER_LIMITS[tier];
  if (limit === null) return { used, limit: null, remaining: null, tight: false, full: false };
  // Clamped: a limit that moved under us shouldn't render a negative.
  const remaining = Math.max(0, limit - used);
  return { used, limit, remaining, tight: remaining <= 1, full: remaining === 0 };
}

/** The line shown beside the count. Names the action, not just the number —
    the fix is a conversation with Xero and there's no point learning that at
    the moment it's already too late. */
export function capacityNote(c: Capacity): string {
  if (c.limit === null) return "No connection limit on this tier.";
  if (c.full) return `Limit reached (${c.limit}). No new customer can connect until the tier is raised.`;
  if (c.tight) return `${c.remaining} left of ${c.limit} — ask Xero to raise the tier now.`;
  return `${c.remaining} left of ${c.limit} on this tier.`;
}
