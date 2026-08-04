/* Server-side capability gate.

   Reads role + overrides from memberships PER REQUEST (React cache() = one
   query per request), NOT from the Auth0 session. The session caches orgRole
   until re-login, which is acceptable for a rare role change but wrong for a
   permissions toggle the owner just flipped — can() must reflect it on the
   next request. Side effect: the DB role also wins over a stale session role.

   The session is still the source of WHO (sub) and WHERE (orgId). */

import { cache } from "react";
import { auth0 } from "./auth0";
import { supabaseAdmin } from "./supabase-server";
import { isMasterOwner, resolve, type Capability, type Ownership } from "./permissions";
import type { Role } from "./roles-shared";

type Membership = {
  role: Role | null;
  permissions: unknown;
  userId: string;
  /** organizations.primary_owner_user_id — the master owner of the active org */
  primaryOwnerUserId: string;
  /** organizations.trading_name — drives the sidebar "HeyTiff x ..." line */
  orgName: string | null;
  /** organizations.logo_url — a STORAGE REF, signed by the caller that renders it */
  orgLogoRef: string | null;
  /** organizations.state — the org's home state, and so the public-holiday
      calendar anyone without their own override is paid against. Rides the
      query that was already being made. */
  orgState: string | null;
};

const EMPTY: Membership = {
  role: null,
  permissions: null,
  userId: "",
  // Never equal to a real userId, so isMasterOwner() can't accidentally
  // match when we failed to load anything.
  primaryOwnerUserId: " none",
  orgName: null,
  orgLogoRef: null,
  orgState: null,
};

const getMembership = cache(async (): Promise<Membership> => {
  const session = await auth0.getSession();
  const userId = session?.user.sub as string | undefined;
  const orgId = session?.orgId as string | undefined;
  if (!userId || !orgId) return EMPTY;

  const [membership, org] = await Promise.all([
    supabaseAdmin
      .from("memberships")
      .select("role, permissions")
      .eq("user_id", userId)
      .eq("org_id", orgId)
      .maybeSingle(),
    supabaseAdmin
      .from("organizations")
      .select("primary_owner_user_id, trading_name, logo_url, state")
      .eq("id", orgId)
      .maybeSingle(),
  ]);

  // Fail closed: an error or missing row resolves to no capabilities.
  if (membership.error || !membership.data) return EMPTY;
  return {
    role: (membership.data.role as Role) ?? null,
    permissions: membership.data.permissions,
    userId,
    primaryOwnerUserId:
      (org.data?.primary_owner_user_id as string | undefined) ?? EMPTY.primaryOwnerUserId,
    orgName: (org.data?.trading_name as string | undefined) ?? null,
    orgLogoRef: (org.data?.logo_url as string | undefined) ?? null,
    orgState: (org.data?.state as string | undefined) ?? null,
  };
});

/** Trading name of the active org — the sidebar's "HeyTiff × …" line.
    Null until the owner sets one (the legacy `name` column is a signup-email
    seed and is deliberately never shown). */
export async function getOrgName(): Promise<string | null> {
  return (await getMembership()).orgName;
}

/** The org logo's STORAGE REF, for the sidebar lockup. Rides the membership
    query that was already being made, so it costs no extra round trip; the
    caller signs it (lib/documents/query.ts::signOne) because a link into a
    private bucket has to be minted per render. */
export async function getOrgLogoRef(): Promise<string | null> {
  return (await getMembership()).orgLogoRef;
}

/** The org's home state. The staff card resolves an unset holiday state
    against it, so a card can answer "which state's public holidays?" with a
    state rather than with a sentence about a setting. Null until the owner
    sets one — the caller then shows nothing rather than guessing. */
export async function getOrgState(): Promise<string | null> {
  return (await getMembership()).orgState;
}

/** Role + identity + who the org's master owner is — for ownership checks. */
export async function getOwnership(): Promise<Ownership> {
  const m = await getMembership();
  return { role: m.role, userId: m.userId, primaryOwnerUserId: m.primaryOwnerUserId };
}

/** True only for the org's single master owner (not co-owners). */
export async function isMaster(): Promise<boolean> {
  return isMasterOwner(await getOwnership());
}

/** The signed-in user's effective capabilities in their active org. */
export async function getCapabilities(): Promise<Set<Capability>> {
  const m = await getMembership();
  return resolve(m.role, m.permissions);
}

/** Server-side gate — use this, not hasMinRole, for every feature check. */
export async function can(capability: Capability): Promise<boolean> {
  return (await getCapabilities()).has(capability);
}

/** Fresh role from the DB — for the owner-intrinsic checks (change roles,
    invite/offboard, billing, org settings). Unlike the session-cached
    orgRole this is not stale-able: a demoted admin loses these on the next
    request, not at their next login. */
export async function getDbRole(): Promise<Role | null> {
  return (await getMembership()).role;
}

/** The server actions' shared front door. Server Functions are reachable by
    direct POST, so every action re-checks the session for itself — this is
    that check, plus the feature gate when a capability is named. Leave the
    capability off only where being a signed-in member IS the permission
    (your own staff card); a feature's actions must name the same capability
    that gates the feature's route. */
export async function requireOrg(
  capability?: Capability
): Promise<{ orgId: string; userId: string }> {
  const session = await auth0.getSession();
  if (!session) throw new Error("Not authenticated");
  const orgId = session.orgId as string | undefined;
  if (!orgId) throw new Error("No active organization");
  if (capability && !(await can(capability))) throw new Error("Insufficient permissions");
  return { orgId, userId: session.user.sub as string };
}
