import type { MobileIdentity } from "@/lib/mobile/identity";

/** The web session as the first door's identity (lib/mobile/start): who, and an address that counts for an
    invitation only when Auth0 has verified it, exactly as the phone's door decides (lib/mobile/identity). */
export function sessionIdentity(
  session: { user?: { sub?: unknown; email?: unknown; email_verified?: unknown; name?: unknown } } | null | undefined
): MobileIdentity | null {
  const sub = session?.user?.sub;
  if (typeof sub !== "string" || !sub) return null;
  const u = session!.user!;
  const raw = typeof u.email === "string" ? u.email.trim().toLowerCase() : "";
  const name = typeof u.name === "string" && u.name.trim() && !u.name.includes("@") ? u.name.trim() : null;
  return { userId: sub, email: raw && u.email_verified === true ? raw : null, shownEmail: raw || null, name };
}
