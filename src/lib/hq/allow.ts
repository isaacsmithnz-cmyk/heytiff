/* Platform-team (cross-org) access for the HeyTiff HQ portal.

   Unlike org roles (owner/admin/staff, per-tenant via memberships — see
   lib/roles.ts), HQ access is PLATFORM-level: it's for HeyTiff employees who
   administer the whole platform, and it's granted by the HQ_EMAILS env var —
   a comma-separated allowlist of login emails. It gates the hidden /hq portal
   and is invisible to customer orgs (a non-listed user gets a 404, not a 403).

   Pure + IO-free so it unit-tests without env or mocks (house style: keep the
   allowlist logic here, the session lookup in guard.ts). Fails CLOSED: an
   unset/empty allowlist or a missing email is never allowed. */

/** Parse HQ_EMAILS into a normalised allowlist (trimmed, lowercased, no blanks). */
export function hqAllowlist(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Is this login email on the HQ allowlist? Case-insensitive; fails closed. */
export function isHqEmail(
  email: string | null | undefined,
  raw: string | undefined = process.env.HQ_EMAILS
): boolean {
  if (!email) return false;
  return hqAllowlist(raw).includes(email.trim().toLowerCase());
}
