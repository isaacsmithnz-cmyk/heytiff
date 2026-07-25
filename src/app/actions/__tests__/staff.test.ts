/* saveStaffSection — the enforcement point for editing someone else's card.
   Every test here answers "what happens on a direct POST", since that is the
   only threat model that matters for a Server Function. */

import { resolve, type Capability } from "@/lib/permissions";
import type { Role } from "@/lib/roles-shared";

type TargetRow = {
  user_id: string | null;
  first_name?: string | null;
  last_name?: string | null;
};
type MemberRow = { role: Role; permissions: unknown } | null;

const staffUpdate = jest.fn();
const membershipUpdate = jest.fn();
const auditInsert = jest.fn();

let target: TargetRow | null = { user_id: "auth0|target" };
let member: MemberRow = { role: "staff", permissions: {} };
let actor = {
  userId: "auth0|owner",
  role: "owner" as Role | null,
  primaryOwnerUserId: "auth0|owner",
  caps: resolve("owner") as ReadonlySet<Capability>,
};

function chain(result: unknown) {
  const node: Record<string, unknown> = {
    maybeSingle: jest.fn().mockResolvedValue({ data: result, error: null }),
  };
  node.eq = jest.fn(() => node);
  node.select = jest.fn(() => node);
  return node;
}

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "staff_profiles") {
        return {
          select: () => chain(target),
          update: (patch: unknown) => {
            staffUpdate(patch);
            const n: Record<string, unknown> = {};
            n.eq = jest.fn(() => n);
            Object.assign(n, { then: undefined });
            return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
          },
        };
      }
      if (table === "memberships") {
        return {
          select: () => chain(member),
          update: (patch: unknown) => {
            membershipUpdate(patch);
            return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
          },
        };
      }
      if (table === "permission_audit") {
        return { insert: (rows: unknown) => { auditInsert(rows); return Promise.resolve({ error: null }); } };
      }
      throw new Error(`unexpected table ${table}`);
    },
  },
}));

jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn(() => Promise.resolve({ user: { sub: "auth0|owner" }, orgId: "org-1" })) },
}));

jest.mock("@/lib/permissions-server", () => ({
  getCapabilities: jest.fn(() => Promise.resolve(actor.caps)),
  getOwnership: jest.fn(() =>
    Promise.resolve({
      role: actor.role,
      userId: actor.userId,
      primaryOwnerUserId: actor.primaryOwnerUserId,
    })
  ),
}));

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { saveStaffSection } from "../staff";

beforeEach(() => {
  staffUpdate.mockClear();
  membershipUpdate.mockClear();
  auditInsert.mockClear();
  target = { user_id: "auth0|target", first_name: "Jordan", last_name: "Mills" };
  member = { role: "staff", permissions: {} };
  actor = {
    userId: "auth0|owner",
    role: "owner",
    primaryOwnerUserId: "auth0|owner",
    caps: resolve("owner"),
  };
});

const asAdmin = (extra: Record<string, boolean> = {}) => {
  actor = {
    userId: "auth0|admin",
    role: "admin",
    primaryOwnerUserId: "auth0|owner",
    caps: resolve("admin", extra),
  };
};

describe("section + capability gating", () => {
  it("refuses everything without `team`", async () => {
    actor = { ...actor, role: "staff", caps: resolve("staff") };
    const res = await saveStaffSection("s1", "personal", { first_name: "X" });
    expect(res).toEqual({ ok: false, error: "You don't have access to staff records." });
    expect(staffUpdate).not.toHaveBeenCalled();
  });

  it("lets an admin edit identity", async () => {
    asAdmin();
    const res = await saveStaffSection("s1", "personal", {
      first_name: "Jordan",
      last_name: "Mills",
    });
    expect(res).toEqual({ ok: true });
    expect(staffUpdate.mock.calls[0][0]).toMatchObject({
      first_name: "Jordan",
      last_name: "Mills",
      // derived from the two halves, never submitted
      full_name: "Jordan Mills",
    });
  });

  it("derives full_name from the stored half a partial save doesn't carry", async () => {
    asAdmin();
    const res = await saveStaffSection("s1", "personal", { last_name: "van der Berg" });
    expect(res).toEqual({ ok: true });
    expect(staffUpdate.mock.calls[0][0]).toMatchObject({
      full_name: "Jordan van der Berg",
    });
  });

  it("refuses payroll for an admin without `financials`", async () => {
    asAdmin();
    const res = await saveStaffSection("s1", "payroll", { hourly_wage: "80" });
    expect(res).toEqual({ ok: false, error: "Only an owner can change pay." });
    expect(staffUpdate).not.toHaveBeenCalled();
  });

  it("allows payroll once `financials` is granted", async () => {
    asAdmin({ financials: true });
    const res = await saveStaffSection("s1", "payroll", { hourly_wage: "80" });
    expect(res).toEqual({ ok: true });
    expect(staffUpdate.mock.calls[0][0]).toMatchObject({ hourly_wage: 80 });
  });

  it("refuses an invented section without touching the database", async () => {
    const res = await saveStaffSection("s1", "__proto__", { first_name: "X" });
    expect(res.ok).toBe(false);
    expect(staffUpdate).not.toHaveBeenCalled();
  });

  it("strips pay columns from a non-pay section", async () => {
    const res = await saveStaffSection("s1", "personal", {
      first_name: "Jordan",
      hourly_wage: "999",
    });
    expect(res).toEqual({ ok: true });
    expect(staffUpdate.mock.calls[0][0]).not.toHaveProperty("hourly_wage");
  });

  it("404s a staff id that isn't in this org", async () => {
    target = null; // the org-scoped lookup found nothing
    const res = await saveStaffSection("someone-elses-uuid", "personal", { first_name: "X" });
    expect(res).toEqual({ ok: false, error: "That staff member doesn't exist." });
    expect(staffUpdate).not.toHaveBeenCalled();
  });

  it("reports a bad cost split rather than storing it", async () => {
    const res = await saveStaffSection("s1", "payroll", {
      cost_install: "50",
      cost_service: "30",
      cost_admin: "10",
    });
    expect(res).toEqual({
      ok: false,
      error: "The cost split has to add up to 100%.",
      fields: ["cost_split"],
    });
    expect(staffUpdate).not.toHaveBeenCalled();
  });
});

describe("permissions — role changes", () => {
  it("promotes staff to admin and clears their overrides", async () => {
    member = { role: "staff", permissions: { approvals: true } };
    const res = await saveStaffSection("s1", "permissions", { org_role: "admin" });
    expect(res).toEqual({ ok: true });
    expect(membershipUpdate).toHaveBeenCalledWith({ role: "admin", permissions: {} });
  });

  it("writes an audit row naming the change", async () => {
    await saveStaffSection("s1", "permissions", { org_role: "admin" });
    const rows = auditInsert.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      org_id: "org-1",
      actor_user_id: "auth0|owner",
      target_user_id: "auth0|target",
      change_type: "role",
      detail: { from: "staff", to: "admin", cleared_overrides: true },
    });
  });

  it("refuses a role change from a non-owner, even a delegated manager", async () => {
    asAdmin({ permissions: true });
    const res = await saveStaffSection("s1", "permissions", { org_role: "owner" });
    expect(res).toEqual({ ok: false, error: "You can't change this person's role." });
    expect(membershipUpdate).not.toHaveBeenCalled();
  });

  it("refuses a role that isn't a role", async () => {
    const res = await saveStaffSection("s1", "permissions", { org_role: "superuser" });
    expect(res).toEqual({ ok: false, error: "That isn't a role." });
  });

  it("refuses to touch the master owner", async () => {
    target = { user_id: "auth0|owner" }; // the master
    member = { role: "owner", permissions: {} };
    const res = await saveStaffSection("s1", "permissions", { org_role: "admin" });
    expect(res.ok).toBe(false);
    expect(membershipUpdate).not.toHaveBeenCalled();
  });

  it("refuses self-edit — no self-escalation", async () => {
    target = { user_id: "auth0|admin" };
    member = { role: "admin", permissions: {} };
    asAdmin({ permissions: true }); // actor IS auth0|admin
    const res = await saveStaffSection("s1", "permissions", { org_role: "owner" });
    expect(res).toEqual({ ok: false, error: "You can't change this person's access." });
    expect(membershipUpdate).not.toHaveBeenCalled();
  });
});

describe("permissions — capability toggles", () => {
  it("grants a capability and stores only the difference from the default", async () => {
    const res = await saveStaffSection("s1", "permissions", { cap_team: "on" });
    expect(res).toEqual({ ok: true });
    // staff default has no `team`, so the override is recorded
    expect(membershipUpdate).toHaveBeenCalledWith({ permissions: { team: true } });
  });

  it("does not store an override that matches the role default", async () => {
    // toolbox is on by default for staff; asking for "on" changes nothing
    const res = await saveStaffSection("s1", "permissions", { cap_toolbox: "on" });
    expect(res).toEqual({ ok: true });
    expect(membershipUpdate).not.toHaveBeenCalled();
  });

  it("records a revoke of a default capability", async () => {
    await saveStaffSection("s1", "permissions", { cap_toolbox: "off" });
    expect(membershipUpdate).toHaveBeenCalledWith({ permissions: { toolbox: false } });
  });

  it("audits each capability change separately", async () => {
    await saveStaffSection("s1", "permissions", { cap_team: "on", cap_approvals: "on" });
    const rows = auditInsert.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    expect(rows.map((r: { detail: { capability: string } }) => r.detail.capability).sort()).toEqual([
      "approvals",
      "team",
    ]);
    expect(rows[0].change_type).toBe("capability");
  });

  it("refuses an owner-tier grant from a delegated manager — the money side door", async () => {
    asAdmin({ permissions: true });
    const res = await saveStaffSection("s1", "permissions", { cap_financials: "on" });
    expect(res).toEqual({ ok: false, error: "Only an owner can grant financials." });
    expect(membershipUpdate).not.toHaveBeenCalled();
  });

  it("refuses re-delegation of `permissions` by a delegated manager", async () => {
    asAdmin({ permissions: true });
    const res = await saveStaffSection("s1", "permissions", { cap_permissions: "on" });
    expect(res.ok).toBe(false);
    expect(membershipUpdate).not.toHaveBeenCalled();
  });

  it("lets a delegated manager toggle an operational capability", async () => {
    asAdmin({ permissions: true });
    const res = await saveStaffSection("s1", "permissions", { cap_assets_all: "on" });
    expect(res).toEqual({ ok: true });
    expect(membershipUpdate).toHaveBeenCalledWith({ permissions: { assets_all: true } });
  });

  it("refuses permissions edits on someone who hasn't accepted their invite", async () => {
    target = { user_id: null };
    const res = await saveStaffSection("s1", "permissions", { cap_team: "on" });
    expect(res).toEqual({ ok: false, error: "They haven't accepted their invite yet." });
  });

  it("is a no-op — and writes no audit — when nothing actually changed", async () => {
    const res = await saveStaffSection("s1", "permissions", { org_role: "staff" });
    expect(res).toEqual({ ok: true });
    expect(membershipUpdate).not.toHaveBeenCalled();
    expect(auditInsert).not.toHaveBeenCalled();
  });
});
