import { buildOrgRows, joinMembersToProfiles } from "../overview";

describe("buildOrgRows", () => {
  const orgs = [
    { id: "o1", name: "Acme", created_at: "2026-01-01T00:00:00Z" },
    { id: "o2", name: "Globex", created_at: "2026-03-01T00:00:00Z" },
    { id: "o3", name: "Newco", created_at: "2026-02-01T00:00:00Z" },
  ];
  const memberships = [
    { org_id: "o1", user_id: "u1" },
    { org_id: "o1", user_id: "u2" },
    { org_id: "o2", user_id: "u3" },
  ];
  const designs = [
    { org_id: "o1", updated_at: "2026-05-01T00:00:00Z" },
    { org_id: "o1", updated_at: "2026-06-15T00:00:00Z" },
  ];

  it("counts members and designs and picks the latest activity", () => {
    const rows = buildOrgRows(orgs, memberships, designs);
    const acme = rows.find((r) => r.id === "o1")!;
    expect(acme.memberCount).toBe(2);
    expect(acme.designCount).toBe(2);
    expect(acme.lastActivity).toBe("2026-06-15T00:00:00Z");
  });

  it("zero-activity orgs get 0 counts and null activity", () => {
    const rows = buildOrgRows(orgs, memberships, designs);
    const newco = rows.find((r) => r.id === "o3")!;
    expect(newco.memberCount).toBe(0);
    expect(newco.designCount).toBe(0);
    expect(newco.lastActivity).toBeNull();
  });

  it("sorts newest-created first", () => {
    expect(buildOrgRows(orgs, memberships, designs).map((r) => r.id)).toEqual([
      "o2",
      "o3",
      "o1",
    ]);
  });
});

describe("joinMembersToProfiles", () => {
  const members = [
    { user_id: "u1", role: "owner", created_at: "2026-01-01T00:00:00Z" },
    { user_id: "u2", role: "staff", created_at: "2026-02-01T00:00:00Z" },
  ];
  const profiles = [
    {
      user_id: "u1",
      email: "a@x.com",
      name: "Ann",
      last_login_at: "2026-06-01T00:00:00Z",
    },
  ];

  it("attaches profile data and flags members without a profile", () => {
    const rows = joinMembersToProfiles(members, profiles);
    const u2 = rows.find((r) => r.userId === "u2")!;
    expect(u2.hasProfile).toBe(false);
    expect(u2.email).toBeNull();
    const u1 = rows.find((r) => r.userId === "u1")!;
    expect(u1.hasProfile).toBe(true);
    expect(u1.email).toBe("a@x.com");
  });

  it("keeps every membership even with no matching profile, newest join first", () => {
    const rows = joinMembersToProfiles(members, profiles);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.userId)).toEqual(["u2", "u1"]);
  });
});
