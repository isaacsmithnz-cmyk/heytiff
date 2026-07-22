import { NAV, NAV_GROUPS, isActive, navFor, navGroupsFor, type NavItem } from "../nav";

const byKey = (key: string) => NAV.find((n) => n.key === key) as NavItem;

describe("nav config", () => {
  it("flattens groups into NAV", () => {
    const flatFromGroups = NAV_GROUPS.flatMap((g) => g.items);
    expect(NAV).toHaveLength(flatFromGroups.length);
    expect(NAV.map((n) => n.key)).toEqual(flatFromGroups.map((n) => n.key));
  });

  it("has unique keys and hrefs under /dashboard", () => {
    const keys = NAV.map((n) => n.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const n of NAV) {
      expect(n.href.startsWith("/dashboard")).toBe(true);
    }
  });

  it("groups the operations section as designed", () => {
    const ops = NAV_GROUPS.find((g) => g.label === "Operations");
    expect(ops?.items.map((i) => i.key)).toEqual([
      "people",
      "timepay",
      "assets",
      "admin",
    ]);
  });
});

describe("role gating", () => {
  it("hides Team and Time & Pay below admin", () => {
    const staffKeys = navFor("staff").map((n) => n.key);
    expect(staffKeys).not.toContain("people");
    expect(staffKeys).not.toContain("timepay");
    expect(navFor("admin").map((n) => n.key)).toEqual(
      expect.arrayContaining(["people", "timepay"])
    );
  });

  it("hides Admin from staff only — admins reach the section, owner-only items gate inside it", () => {
    expect(navFor("staff").map((n) => n.key)).not.toContain("admin");
    expect(navFor("admin").map((n) => n.key)).toContain("admin");
    expect(navFor("owner").map((n) => n.key)).toContain("admin");
  });

  it("hides gated entries from a signed-out / role-less user", () => {
    const keys = navFor(null).map((n) => n.key);
    for (const gated of ["people", "timepay", "admin"]) {
      expect(keys).not.toContain(gated);
    }
  });

  it("leaves ungated entries alone for every role", () => {
    const ungated = NAV.filter((n) => !n.minRole).map((n) => n.key);
    for (const role of ["staff", "admin", "owner", null] as const) {
      expect(navFor(role).map((n) => n.key)).toEqual(
        expect.arrayContaining(ungated)
      );
    }
  });

  it("keeps groups but drops those emptied by filtering", () => {
    const groups = navGroupsFor("staff");
    expect(groups.map((g) => g.label)).toEqual(["Workspace", "Operations"]);
    // staff keep only the ungated assets placeholder in Operations for now;
    // it becomes My vehicle when the Mine group lands
    expect(groups.find((g) => g.label === "Operations")?.items.map((i) => i.key))
      .toEqual(["assets"]);
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
  });

  it("owner sees the full Operations group", () => {
    expect(navGroupsFor("owner").find((g) => g.label === "Operations")?.items.map((i) => i.key))
      .toEqual(["people", "timepay", "assets", "admin"]);
  });
});

describe("isActive", () => {
  it("matches Dashboard only on the exact path", () => {
    const home = byKey("home");
    expect(isActive(home, "/dashboard")).toBe(true);
    expect(isActive(home, "/dashboard/team")).toBe(false);
  });

  it("matches a section on its path and nested paths", () => {
    const team = byKey("people");
    expect(isActive(team, "/dashboard/team")).toBe(true);
    expect(isActive(team, "/dashboard/team/jordan-mills")).toBe(true);
    expect(isActive(team, "/dashboard")).toBe(false);
    expect(isActive(team, "/dashboard/timepay")).toBe(false);
  });
});
