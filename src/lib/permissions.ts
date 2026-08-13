/* Capability model — pure, no server imports (client-safe, like roles-shared).

   Role is a DEFAULT, not a verdict: it seeds a capability set, and the owner
   can grant/revoke individual capabilities per person in Team. Enforcement
   always asks "can(capability)?", never "which role?" — except for the
   owner-intrinsic actions (set permissions, change roles, invite/offboard,
   billing, org settings), which stay role-based by definition.

   Overrides live in memberships.permissions (jsonb, migration
   `membership_permissions_and_rls_fn_lockdown`): sparse — a key present is an
   explicit grant (true) or revoke (false), absent means "role default", so
   defaults can evolve without rewriting rows. A role change resets it to '{}'. */

import type { Role } from "./roles-shared";

export const CAPABILITIES = [
  "toolbox", // calculators & references
  "studio", // Design Studio
  "tiff", // Tiff AI assistant & document library
  "tiff_manage", // upload/edit/retry knowledge-base documents (delete is owner-only)
  "workboard", // see the projects & maintenance board (techs live here)
  "workboard_manage", // create/edit projects, agreements, visits & readiness
  "workboard_money", // job values, claims & payment status on the board
  "team", // view/manage other staff records
  "timepay_all", // everyone's timesheets (own timesheet is intrinsic, not gated)
  "approvals", // approve hours, leave & expenses (acts within timepay_all's surface)
  "assets_all", // whole fleet & equipment register (own vehicle is intrinsic)
  "financials", // OTHER people's wages, pay rates, gross $, charge-out
  "permissions", // change OTHER people's capabilities (see OWNER_TIER below)
  "invites", // invite & offboard people (see invitableRoles — staff only)
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/* Owner-tier capabilities: a delegated permission-manager can toggle the
   operational capabilities on other people's cards, but only the OWNER can
   grant these three. Otherwise delegation is a side door into the money — a
   manager grants an accomplice `financials`, or re-delegates `permissions`
   onward. Role changes, invite/offboard and billing stay owner-only outright.

   `workboard_money` joins them because it IS money, just a different pocket:
   what each job is worth, what has been claimed, and what the customer has
   paid. It is deliberately NOT folded into `financials` — that one is wages,
   pay rates and charge-out, and a business that wants its project manager
   costing jobs should not have to show them everyone's pay to do it. Nor is it
   folded into `workboard_manage`: running the board (booking, readiness,
   agreements) is a foreman's job and revenue is not automatically their
   business. Two separate grants, because they answer to two separate people. */
export const OWNER_TIER: ReadonlySet<Capability> = new Set([
  "financials",
  "permissions",
  "workboard_money",
]);

export function isCapability(v: unknown): v is Capability {
  return typeof v === "string" && (CAPABILITIES as readonly string[]).includes(v);
}

// workboard is a staff default: the board is FOR the people on the tools —
// seeing what's booked, what's overdue and what to bring is their day.
// Managing it (workboard_manage) follows the timepay_all/approvals precedent:
// admin by default, grantable to a senior tech via the overrides grid.
// workboard_money is in NEITHER default list, admin included: admin is
// "everything operational, no money", and job values are money. The owner
// grants it per person — usually to themselves and whoever quotes.
// tiff_manage mirrors it exactly: everyone READS and asks the library
// (that's `tiff`), but what goes INTO the company library is a curation
// decision — and a wrong manual answers questions wrongly for everyone.
const STAFF_DEFAULTS: readonly Capability[] = ["toolbox", "studio", "tiff", "workboard"];
const ADMIN_DEFAULTS: readonly Capability[] = [
  ...STAFF_DEFAULTS,
  "tiff_manage",
  "workboard_manage",
  "team",
  "timepay_all",
  "approvals",
  "assets_all",
];

export const ROLE_DEFAULTS: Record<Role, readonly Capability[]> = {
  staff: STAFF_DEFAULTS,
  admin: ADMIN_DEFAULTS, // everything operational, no money
  owner: CAPABILITIES,
};

/* ---- Ownership ----------------------------------------------------------

   An org has exactly one MASTER owner (organizations.primary_owner_user_id)
   and any number of CO-OWNERS. Both carry role='owner', so every capability
   check is unchanged — co-owners get the full owner set, including granting
   OWNER_TIER and inviting at any role.

   The difference is a short list of master-only acts, and one protection:
   nobody can demote, remove, or edit the master. That is what makes "one
   master no matter what" true — you can't be locked out of the business by
   someone you promoted. The DB enforces the structural half (NOT NULL +
   composite FK to memberships); these helpers enforce the behavioural half. */

export type Ownership = { role: Role | null; userId: string; primaryOwnerUserId: string };

export function isMasterOwner(o: Ownership): boolean {
  return o.role === "owner" && o.userId === o.primaryOwnerUserId;
}

/** Display label: the master reads "Owner", other owners read "Co-owner". */
export function ownerLabel(o: Ownership): string | null {
  if (o.role !== "owner") return null;
  return isMasterOwner(o) ? "Owner" : "Co-owner";
}

/** Master-only acts. Co-owners are full owners for everything else. */
export const MASTER_ONLY = [
  "transfer_ownership",
  "billing",
  "delete_org",
] as const;
export type MasterAction = (typeof MASTER_ONLY)[number];

export function canPerformMasterAction(actor: Ownership): boolean {
  return isMasterOwner(actor);
}

/** May the actor change this person's role (promote/demote, incl. co-owners)? */
export function canChangeRoleOf(actor: Ownership, target: Ownership): boolean {
  if (actor.role !== "owner") return false; // role changes are owner business
  if (target.userId === actor.userId) return false; // no self role change
  if (isMasterOwner(target)) return false; // the master is untouchable
  return true; // owners (incl. co-owners) may promote/demote anyone else
}

/** May the actor remove this person from the org entirely? */
export function canRemoveMember(actor: Ownership, target: Ownership): boolean {
  if (isMasterOwner(target)) return false; // transfer primacy first — DB agrees
  if (target.userId === actor.userId) return false; // leaving is its own flow
  return actor.role === "owner";
}

/* Delegation rules — pure, used by the Team permissions action AND to render
   the grid (locked rows, disabled cards) so the UI can't promise what the
   server refuses. */

/** May this actor change `cap` on someone else's card? */
export function canSetCapability(actorRole: Role | null, cap: Capability): boolean {
  if (actorRole === "owner") return true;
  return !OWNER_TIER.has(cap); // delegated managers stop at the owner tier
}

/* Which roles may this actor invite at?

   The owner can create admins. A delegated inviter (the office manager who
   handles onboarding) can add STAFF only — because choosing someone's role is
   a role assignment, and role changes are owner-only everywhere else. Letting
   a non-owner invite an admin would be that same decision through the back
   door, and would let the admin population grow without the owner. Owner is
   never invitable at all (DB CHECK: invitations.role in ('admin','staff')). */
export function invitableRoles(actorRole: Role | null, caps: ReadonlySet<Capability>): Role[] {
  if (actorRole === "owner") return ["admin", "staff"];
  if (caps.has("invites")) return ["staff"];
  return [];
}

/** May this actor open the Access grid on this target's card at all?
    Self is always rejected (self-escalation); an owner's card is rejected
    (overrides are ignored for owners, so the write would be a silent no-op). */
export function canEditPermissionsOf(
  actor: { role: Role | null; userId: string; caps: ReadonlySet<Capability> },
  target: { role: Role | null; userId: string | null }
): boolean {
  if (!actor.role) return false;
  if (target.userId !== null && target.userId === actor.userId) return false;
  if (target.role === "owner") return false;
  if (actor.role === "owner") return true;
  return actor.caps.has("permissions");
}

/* Resolve a person's effective capabilities.

   The owner ignores overrides entirely: the owner is the root of trust, and
   respecting overrides would allow one owner to lock another (or a bad write
   to lock the sole owner) out of the money and the permission screen that
   restores it. The Permissions grid renders disabled on owner cards.

   Overrides are read by iterating the CAPABILITIES whitelist — never the
   object's own keys — so junk keys (including "__proto__") and non-boolean
   values are ignored rather than interpreted. */
export function resolve(role: Role | null, overrides?: unknown): Set<Capability> {
  if (!role) return new Set();
  if (role === "owner") return new Set(CAPABILITIES);
  const set = new Set(ROLE_DEFAULTS[role]);
  if (overrides && typeof overrides === "object" && !Array.isArray(overrides)) {
    const o = overrides as Record<string, unknown>;
    for (const cap of CAPABILITIES) {
      // Own properties only: reading o[cap] bare would walk the prototype
      // chain, so `{ __proto__: { financials: true } }` would grant money.
      if (!Object.hasOwn(o, cap)) continue;
      if (o[cap] === true) set.add(cap);
      else if (o[cap] === false) set.delete(cap);
    }
  }
  return set;
}
