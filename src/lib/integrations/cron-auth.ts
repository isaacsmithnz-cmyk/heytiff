/* The shared secret that guards the scheduled routes — pure, so the one
   comparison that matters is testable.

   THIS IS THE WHOLE GATE. A cron route runs as nobody: there is no session, no
   capability, no org — it reaches every workspace's data through the
   service-role client by design. Everything that normally protects those reads
   is absent, so the secret is not an extra layer, it IS the layer.

   FAIL CLOSED ON A MISSING SECRET. An unset CRON_SECRET must refuse every
   request rather than wave them through, because "no secret configured" and
   "no secret supplied" would otherwise be the same thing — and that is an open
   endpoint that walks the whole customer list. */

import { timingSafeEqual } from "node:crypto";

/** Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. */
export function bearerToken(header: string | null): string {
  const value = (header ?? "").trim();
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match ? match[1].trim() : "";
}

/** Constant-time, so the comparison can't be walked a character at a time. */
export function secretMatches(supplied: string, expected: string | undefined): boolean {
  if (!expected) return false; // unset ⇒ closed, never open
  if (!supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  // Length is compared first because timingSafeEqual throws on a mismatch —
  // it leaks the length either way, which is not the secret.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function authorised(header: string | null, expected = process.env.CRON_SECRET): boolean {
  return secretMatches(bearerToken(header), expected);
}
