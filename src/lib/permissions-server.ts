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
};

const EMPTY: Membership = {
  role: null,
  permissions: null,
  userId: "",
  // Never equal to a real userId, so isMasterOwner() can't accidentally
  // match when we failed to load anything.
  primaryOwnerUserId: " none",
  orgName: null,
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
      .select("primary_owner_user_id, trading_name")
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
  };
});

/** Trading name of the active org — the sidebar's "HeyTiff × …" line.
    Null until the owner sets one (the legacy `name` column is a signup-email
    seed and is deliberately never shown). */
export async function getOrgName(): Promise<string | null> {
  return (await getMembership()).orgName;
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
