/* Platform-team (cross-org) access for the HeyTiff HQ portal.

   Unlike org roles (owner/admin/staff, per-tenant via memberships — see
   lib/roles.ts), HQ access is PLATFORM-level: it's for HeyTiff employees who
   administer the whole platform, and it's granted by the HQ_USER_IDS env var —
   a comma-separated allowlist of Auth0 user ids (`auth0|6a3a…`, the session's
   `sub`). It gates the hidden /hq portal and is invisible to customer orgs (a
   non-listed user gets a 404, not a 403).

   AN ID, NOT AN EMAIL (2026-10-05). The list used to be login emails. Isaac
   changed his sign-in address, the list still held the old one, and HQ
   answered him with a 404 until the env var was found and edited. An email is
   not an identity here either: a Google sign-in and a password sign-in with
   the same address are two different Auth0 users (prod has exactly that
   pair), so an email list let in whichever one turned up. The id is the
   account, and it never changes.

   Pure + IO-free so it unit-tests without env or mocks (house style: keep the
   allowlist logic here, the session lookup in guard.ts). Fails CLOSED: an
   unset/empty allowlist or a missing id is never allowed. */

/** Parse HQ_USER_IDS into an allowlist (trimmed, no blanks). Ids are compared
    exactly — Auth0's are case-sensitive. */
export function hqAllowlist(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

/** Is this Auth0 user id on the HQ allowlist? Fails closed. */
export function isHqUser(
  userId: string | null | undefined,
  raw: string | undefined = process.env.HQ_USER_IDS
): boolean {
  if (!userId) return false;
  return hqAllowlist(raw).includes(userId.trim());
}
