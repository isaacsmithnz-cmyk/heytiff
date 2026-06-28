import { NAV, NAV_GROUPS, isActive, type NavItem } from "../nav";

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
