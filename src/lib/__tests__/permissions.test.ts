import {
  CAPABILITIES,
  MASTER_ONLY,
  OWNER_TIER,
  ROLE_DEFAULTS,
  canChangeRoleOf,
  canEditPermissionsOf,
  canPerformMasterAction,
  canRemoveMember,
  canSetCapability,
  invitableRoles,
  isCapability,
  isMasterOwner,
  ownerLabel,
  resolve,
} from "../permissions";
import { VEHICLE_PICKER_FIELDS, VEHICLE_SENSITIVE_FIELDS } from "../projections";

describe("role defaults", () => {
  it("staff: shared tools only — nothing operational, no money", () => {
    const caps = resolve("staff");
    expect([...caps].sort()).toEqual(["studio", "tiff", "toolbox"]);
  });

  it("admin: everything operational, no money", () => {
    const caps = resolve("admin");
    expect(caps.has("team")).toBe(true);
    expect(caps.has("timepay_all")).toBe(true);
    expect(caps.has("approvals")).toBe(true);
    expect(caps.has("assets_all")).toBe(true);
    expect(caps.has("financials")).toBe(false);
  });

  it("owner: everything", () => {
    expect(resolve("owner").size).toBe(CAPABILITIES.length);
  });

  it("no role: nothing", () => {
    expect(resolve(null).size).toBe(0);
    expect(resolve(null, { financials: true }).size).toBe(0);
  });

  it("ROLE_DEFAULTS only contains real capabilities", () => {
    for (const caps of Object.values(ROLE_DEFAULTS)) {
      for (const c of caps) expect(isCapability(c)).toBe(true);
    }
  });
});

describe("overrides — grant and revoke", () => {
  it("owner grants financials to an admin", () => {
    const caps = resolve("admin", { financials: true });
    expect(caps.has("financials")).toBe(true);
    // nothing else changed
    expect(caps.has("team")).toBe(true);
  });

  it("owner grants approvals to a senior staff member", () => {
    const caps = resolve("staff", { approvals: true });
    expect(caps.has("approvals")).toBe(true);
    expect(caps.has("timepay_all")).toBe(false); // grant is surgical, not a promotion
  });

  it("owner revokes a default from an admin", () => {
    const caps = resolve("admin", { assets_all: false });
    expect(caps.has("assets_all")).toBe(false);
    expect(caps.has("team")).toBe(true);
  });

  it("a role change resets overrides — resolve('{}') is exactly the defaults", () => {
    // staff with grants → promoted to admin, overrides cleared server-side
    const promoted = resolve("admin", {});
    expect([...promoted].sort()).toEqual([...resolve("admin")].sort());
  });

  it("revoking a capability the role never had is a no-op", () => {
    expect([...resolve("staff", { financials: false })].sort()).toEqual(
      [...resolve("staff")].sort()
    );
  });
});

describe("owner is the root of trust — overrides are ignored", () => {
  it("cannot be locked out of money by a stored revoke", () => {
    const caps = resolve("owner", { financials: false, team: false });
    expect(caps.has("financials")).toBe(true);
    expect(caps.has("team")).toBe(true);
  });
});

describe("hostile / junk overrides", () => {
  it("ignores non-boolean values", () => {
    const caps = resolve("staff", { team: "yes", financials: 1, approvals: "true" });
    expect(caps.has("team")).toBe(false);
    expect(caps.has("financials")).toBe(false);
    expect(caps.has("approvals")).toBe(false);
  });

  it("ignores unknown keys, including prototype names", () => {
    const caps = resolve("staff", {
      superuser: true,
      __proto__: { financials: true },
      constructor: true,
    });
    expect([...caps].sort()).toEqual([...resolve("staff")].sort());
  });

  it("ignores non-object overrides entirely", () => {
    for (const junk of [null, undefined, "financials", 42, ["financials"], true]) {
      expect([...resolve("admin", junk)].sort()).toEqual([...resolve("admin")].sort());
    }
  });
});

describe("delegated permission management", () => {
  const ownerActor = { role: "owner" as const, userId: "auth0|own", caps: resolve("owner") };
  const managerActor = {
    role: "admin" as const,
    userId: "auth0|mgr",
    caps: resolve("admin", { permissions: true }),
  };
  const plainAdmin = { role: "admin" as const, userId: "auth0|adm", caps: resolve("admin") };

  it("`permissions` is not part of any default except owner", () => {
    expect(resolve("staff").has("permissions")).toBe(false);
    expect(resolve("admin").has("permissions")).toBe(false);
    expect(resolve("owner").has("permissions")).toBe(true);
  });

  it("owner can grant it to an admin like any capability", () => {
    expect(managerActor.caps.has("permissions")).toBe(true);
  });

  it("a delegated manager can edit other non-owner cards", () => {
    expect(canEditPermissionsOf(managerActor, { role: "staff", userId: "auth0|s1" })).toBe(true);
    expect(canEditPermissionsOf(managerActor, { role: "admin", userId: "auth0|a2" })).toBe(true);
  });

  it("an admin without the grant cannot", () => {
    expect(canEditPermissionsOf(plainAdmin, { role: "staff", userId: "auth0|s1" })).toBe(false);
  });

  it("nobody edits their own card — self-escalation", () => {
    expect(canEditPermissionsOf(managerActor, { role: "admin", userId: "auth0|mgr" })).toBe(false);
    expect(canEditPermissionsOf(ownerActor, { role: "owner", userId: "auth0|own" })).toBe(false);
  });

  it("nobody edits an owner's card — the write would be an ignored no-op", () => {
    expect(canEditPermissionsOf(managerActor, { role: "owner", userId: "auth0|own" })).toBe(false);
    expect(canEditPermissionsOf(ownerActor, { role: "owner", userId: "auth0|own2" })).toBe(false);
  });

  it("a roster-only card (no login yet) is editable by a manager", () => {
    expect(canEditPermissionsOf(managerActor, { role: null, userId: null })).toBe(true);
  });

  it("a manager can toggle operational capabilities but not the owner tier", () => {
    expect(canSetCapability("admin", "assets_all")).toBe(true);
    expect(canSetCapability("admin", "approvals")).toBe(true);
    expect(canSetCapability("admin", "financials")).toBe(false); // no money side door
    expect(canSetCapability("admin", "permissions")).toBe(false); // no re-delegation chain
  });

  it("the owner can set everything, owner tier included", () => {
    for (const cap of CAPABILITIES) expect(canSetCapability("owner", cap)).toBe(true);
  });

  it("the escalation chain is closed: manager → accomplice → money is refused at both hops", () => {
    // hop 1: manager tries to give an accomplice financials directly
    expect(canSetCapability("admin", "financials")).toBe(false);
    // hop 2: manager tries to make the accomplice a manager who could try again
    expect(canSetCapability("admin", "permissions")).toBe(false);
  });

  it("OWNER_TIER only contains real capabilities", () => {
    for (const cap of OWNER_TIER) expect(isCapability(cap)).toBe(true);
  });
});

describe("master owner vs co-owners", () => {
  const MASTER = "auth0|master";
  const own = (userId: string, role: "owner" | "admin" | "staff" | null = "owner") => ({
    role,
    userId,
    primaryOwnerUserId: MASTER,
  });
  const master = own(MASTER);
  const coOwner = own("auth0|co");
  const admin = own("auth0|adm", "admin");

  it("identifies exactly one master", () => {
    expect(isMasterOwner(master)).toBe(true);
    expect(isMasterOwner(coOwner)).toBe(false);
  });

  it("does not treat a non-owner as master even if the ids line up", () => {
    // defensive: a demoted ex-master must not stay master
    expect(isMasterOwner({ role: "admin", userId: MASTER, primaryOwnerUserId: MASTER })).toBe(false);
  });

  it("labels the master Owner and the rest Co-owner", () => {
    expect(ownerLabel(master)).toBe("Owner");
    expect(ownerLabel(coOwner)).toBe("Co-owner");
    expect(ownerLabel(admin)).toBeNull();
  });

  it("co-owners keep the full capability set — the split is not about access", () => {
    expect([...resolve("owner")].sort()).toEqual([...CAPABILITIES].sort());
    for (const cap of CAPABILITIES) expect(canSetCapability("owner", cap)).toBe(true);
  });

  it("master-only acts are master-only", () => {
    expect(canPerformMasterAction(master)).toBe(true);
    expect(canPerformMasterAction(coOwner)).toBe(false);
    expect(canPerformMasterAction(admin)).toBe(false);
    expect(MASTER_ONLY).toEqual(["transfer_ownership", "billing", "delete_org"]);
  });

  it("nobody can demote the master — the lockout guarantee", () => {
    expect(canChangeRoleOf(coOwner, master)).toBe(false);
    expect(canChangeRoleOf(master, master)).toBe(false); // not even themselves
  });

  it("nobody can remove the master — transfer primacy first", () => {
    expect(canRemoveMember(coOwner, master)).toBe(false);
    expect(canRemoveMember(master, master)).toBe(false);
  });

  it("co-owners can manage everyone else, so you are not a bottleneck", () => {
    expect(canChangeRoleOf(coOwner, admin)).toBe(true);
    expect(canChangeRoleOf(coOwner, own("auth0|co2"))).toBe(true); // incl. other co-owners
    expect(canRemoveMember(coOwner, admin)).toBe(true);
  });

  it("non-owners cannot change roles at all", () => {
    expect(canChangeRoleOf(admin, own("auth0|s1", "staff"))).toBe(false);
    expect(canRemoveMember(admin, own("auth0|s1", "staff"))).toBe(false);
  });

  it("nobody changes their own role or removes themselves here", () => {
    expect(canChangeRoleOf(coOwner, coOwner)).toBe(false);
    expect(canRemoveMember(coOwner, coOwner)).toBe(false);
  });

  it("an owner's permission card stays inert — co-owners included", () => {
    const actor = { role: "owner" as const, userId: MASTER, caps: resolve("owner") };
    expect(canEditPermissionsOf(actor, { role: "owner", userId: "auth0|co" })).toBe(false);
  });
});

describe("invites — delegable, but role assignment is not", () => {
  it("is owner-only by default", () => {
    expect(resolve("staff").has("invites")).toBe(false);
    expect(resolve("admin").has("invites")).toBe(false);
    expect(resolve("owner").has("invites")).toBe(true);
  });

  it("the owner can invite admins or staff", () => {
    expect(invitableRoles("owner", resolve("owner"))).toEqual(["admin", "staff"]);
  });

  it("a granted admin can invite staff only — picking a role is owner business", () => {
    expect(invitableRoles("admin", resolve("admin", { invites: true }))).toEqual(["staff"]);
  });

  it("without the grant, nobody can invite — an empty list is the gate", () => {
    expect(invitableRoles("admin", resolve("admin"))).toEqual([]);
    expect(invitableRoles("staff", resolve("staff"))).toEqual([]);
    expect(invitableRoles(null, resolve(null))).toEqual([]);
  });

  it("a granted staff member can also invite staff — capability, not role", () => {
    expect(invitableRoles("staff", resolve("staff", { invites: true }))).toEqual(["staff"]);
  });

  it("never offers owner — the DB CHECK forbids it and so do we", () => {
    for (const role of ["owner", "admin", "staff"] as const) {
      const caps = resolve(role, { invites: true });
      expect(invitableRoles(role, caps)).not.toContain("owner");
    }
  });

  it("is delegable by a permission-manager — it is not owner-tier", () => {
    expect(canSetCapability("admin", "invites")).toBe(true);
  });

  it("the admin-population escalation path is closed", () => {
    // A delegated inviter cannot mint a peer admin who could then be granted more.
    expect(invitableRoles("admin", resolve("admin", { invites: true }))).not.toContain("admin");
  });
});

describe("vehicle picker projection — the minimum-identity contract", () => {
  it("never overlaps the sensitive field list", () => {
    const picker = new Set<string>(VEHICLE_PICKER_FIELDS);
    for (const f of VEHICLE_SENSITIVE_FIELDS) {
      expect(picker.has(f)).toBe(false);
    }
  });

  it("is exactly the plan's list — identity + guardrail, nothing else", () => {
    expect([...VEHICLE_PICKER_FIELDS].sort()).toEqual(
      ["id", "make", "model", "name", "odometer", "plate", "status"].sort()
    );
  });

  it("keeps commercial and register data sensitive", () => {
    for (const f of ["value", "purchasePrice", "assignedTo", "regoDays", "notes"]) {
      expect(VEHICLE_SENSITIVE_FIELDS).toContain(f);
    }
  });
});
