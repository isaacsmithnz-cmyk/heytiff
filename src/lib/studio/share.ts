/* Live-share link lifetime.

   A customer link is a public, unguessable URL: anyone holding it can read
   the design without signing in. The link is the only thing protecting it,
   so it stops working on its own rather than living forever — a job quoted
   in March shouldn't still be open to the world in December.

   Pure, and the single source of the rule, so the public route and the
   Summary card can never disagree about whether a link is still good. */

export const SHARE_TTL_DAYS = 14;

const DAY_MS = 86_400_000;

/** When a link created at `createdAt` stops working. */
export function shareExpiresAt(createdAt: string | Date): Date {
  return new Date(new Date(createdAt).getTime() + SHARE_TTL_DAYS * DAY_MS);
}

/** Fails CLOSED: a missing or unreadable timestamp counts as expired, so a
    row that predates the expiry column can't be a link that never dies. */
export function isShareExpired(
  createdAt: string | Date | null | undefined,
  now: Date = new Date()
): boolean {
  if (createdAt == null) return true;
  const expires = shareExpiresAt(createdAt).getTime();
  if (!Number.isFinite(expires)) return true;
  return now.getTime() >= expires;
}

/** Whole days remaining, rounded UP so the last part-day still reads "1 day
    left" rather than "0". Never negative. */
export function shareDaysLeft(
  createdAt: string | Date | null | undefined,
  now: Date = new Date()
): number {
  if (createdAt == null) return 0;
  const ms = shareExpiresAt(createdAt).getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.ceil(ms / DAY_MS);
}
