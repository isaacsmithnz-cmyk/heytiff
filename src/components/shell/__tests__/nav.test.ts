import { NAV, NAV_GROUPS, isActive, navFor, navGroupsFor, type NavItem, type NavViewer } from "../nav";
import { CAPABILITIES, resolve } from "@/lib/permissions";
import type { Role } from "@/lib/roles-shared";

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

describe("capability gating", () => {
  /* The viewer is (capabilities + role): capabilities drive everything
     grantable, role only the intrinsic Admin section. */
  const viewer = (role: Role | null) => ({ caps: resolve(role), role });
  const keys = (v: NavViewer) => navFor(v).map((n) => n.key);

  it("hides Team and Time & Pay from staff, shows them to admins", () => {
    expect(keys(viewer("staff"))).not.toContain("people");
    expect(keys(viewer("staff"))).not.toContain("timepay");
    expect(keys(viewer("admin"))).toEqual(expect.arrayContaining(["people", "timepay"]));
  });

  it("hides Admin from staff only — the section is role-intrinsic", () => {
    expect(keys(viewer("staff"))).not.toContain("admin");
    expect(keys(viewer("admin"))).toContain("admin");
    expect(keys(viewer("owner"))).toContain("admin");
  });

  it("shows nothing gated to a signed-out / role-less viewer", () => {
    const k = keys(viewer(null));
    for (const gated of ["people", "timepay", "admin", "toolbox", "ductr", "tiff"]) {
      expect(k).not.toContain(gated);
    }
    expect(k).toEqual(expect.arrayContaining(["home", "myvehicle"]));
    expect(k).not.toContain("assets"); // the register is gated now that My vehicle exists
  });

  it("GRANTING a capability reveals its entry — the point of the model", () => {
    // an admin granted `team`-adjacent access they lacked by default
    const plain = keys({ caps: resolve("staff"), role: "staff" });
    expect(plain).not.toContain("people");

    const granted = keys({ caps: resolve("staff", { team: true }), role: "staff" });
    expect(granted).toContain("people");
    // and nothing else leaked in with it
    expect(granted).not.toContain("timepay");
    expect(granted).not.toContain("admin");
  });

  it("REVOKING a default capability hides its entry", () => {
    const revoked = keys({ caps: resolve("staff", { toolbox: false }), role: "staff" });
    expect(revoked).not.toContain("toolbox");
    expect(revoked).toContain("ductr"); // Design Studio — key is the legacy v3 id
  });

  it("leaves genuinely ungated entries alone for everyone", () => {
    const ungated = NAV.filter((n) => !n.capability && !n.minRole).map((n) => n.key);
    // your own vehicle is intrinsic, like your own timesheet will be
    expect(ungated).toEqual(expect.arrayContaining(["home", "myvehicle"]));
    for (const role of ["staff", "admin", "owner", null] as const) {
      expect(keys(viewer(role))).toEqual(expect.arrayContaining(ungated));
    }
  });

  it("keeps groups but drops those emptied by filtering", () => {
    const groups = navGroupsFor(viewer("staff"));
    // staff hold nothing in Operations, so the whole group goes; Personal stays
    expect(groups.map((g) => g.label)).toEqual(["Workspace", "Personal"]);
    expect(groups.find((g) => g.label === "Personal")?.items.map((i) => i.key)).toEqual([
      "myvehicle",
    ]);
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
  });

  it("Personal is ungated — every viewer keeps their own vehicle", () => {
    for (const role of ["staff", "admin", "owner"] as const) {
      expect(navGroupsFor(viewer(role)).find((g) => g.label === "Personal")?.items.map((i) => i.key))
        .toEqual(["myvehicle"]);
    }
    // and revoking the register doesn't take it away
    expect(keys({ caps: resolve("owner", { assets_all: false }), role: "owner" }))
      .toEqual(expect.arrayContaining(["myvehicle"]));
  });

  it("owner sees the full rail", () => {
    expect(navGroupsFor(viewer("owner")).find((g) => g.label === "Operations")?.items.map((i) => i.key))
      .toEqual(["people", "timepay", "assets", "admin"]);
  });

  it("every capability named in the nav is a real capability", () => {
    for (const n of NAV) {
      if (n.capability) expect(CAPABILITIES).toContain(n.capability);
    }
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
