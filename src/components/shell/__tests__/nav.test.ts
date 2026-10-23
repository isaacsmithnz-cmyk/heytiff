import {
  NAV,
  NAV_GROUPS,
  NAV_ROWS,
  SCREEN_ALIASES,
  isActive,
  navFor,
  navGroupsFor,
  navHref,
  type NavItem,
  screenLabelFor,
  type NavViewer,
} from "../nav";
import { PLACES, YOURS } from "../places";
import { CAPABILITIES, resolve } from "@/lib/permissions";
import type { Role } from "@/lib/roles-shared";

/* ⌘K's and Tiff's screens are v2's (Isaac, 23 October 2026: the old names,
   "Drop them entirely"): the eight places and your name's menu, the same
   list the sidebar draws (places.ts). */

const byKey = (key: string) => NAV.find((n) => n.key === key) as NavItem;
const viewer = (role: Role | null) => ({ caps: resolve(role), role });
const keys = (v: NavViewer) => navFor(v).map((n) => n.key);

describe("nav config", () => {
  it("is the eight places, then your name's menu", () => {
    expect(NAV_GROUPS.map((g) => g.label)).toEqual(["Places", "Yours"]);
    expect(NAV_GROUPS[0].items.map((i) => i.label)).toEqual(PLACES.map((p) => p.label));
    expect(NAV_GROUPS[1].items.map((i) => i.label)).toEqual(YOURS.map((p) => p.label));
  });

  it("goes where the sidebar goes, place for place", () => {
    for (const p of [...PLACES, ...YOURS]) {
      expect(NAV_ROWS.find((n) => n.label === p.label)?.href).toBe(p.href);
    }
  });

  it("names none of the screens v2 retired", () => {
    const labels = NAV.map((n) => n.label);
    for (const gone of ["Workboard", "Toolbox", "Time & Pay", "Assets", "Noticeboard", "Action required", "Me", "Admin", "Analytics"]) {
      expect(labels).not.toContain(gone);
    }
    const hrefs = NAV.map((n) => n.href);
    for (const gone of ["/dashboard/workboard", "/dashboard/toolbox", "/dashboard/timepay", "/dashboard/assets", "/dashboard/notices", "/dashboard/action-required", "/dashboard/tiff"]) {
      expect(hrefs).not.toContain(gone);
    }
    for (const word of ["workboard", "timeandpay", "assets", "toolbox", "noticeboard"]) expect(SCREEN_ALIASES).not.toHaveProperty(word);
  });

  it("carries the faces right after their parent, in ⌘K but not as rows", () => {
    expect(NAV.map((n) => n.key)).toEqual(NAV_ROWS.flatMap((n) => [n.key, ...(n.subItems ?? []).map((s) => s.key)]));
    expect(NAV_ROWS.map((n) => n.key)).not.toContain("mynotes");
    expect(NAV.map((n) => n.key)).toEqual(expect.arrayContaining(["mynotes", "notices"]));
  });

  it("keeps the keys other screens link by", () => {
    expect(navHref("home")).toBe("/dashboard");
    expect(navHref("tiffkb")).toBe("/dashboard/tiff/library");
    expect(navHref("mynotes")).toBe("/dashboard/my-notes");
  });

  it("gives no face a gate of its own, and has unique keys under /dashboard", () => {
    for (const n of NAV_ROWS)
      for (const s of n.subItems ?? []) {
        expect(s).not.toHaveProperty("capability");
        expect(s).not.toHaveProperty("minRole");
      }
    const k = NAV.map((n) => n.key);
    expect(new Set(k).size).toBe(k.length);
    for (const n of NAV) expect(n.href.startsWith("/dashboard")).toBe(true);
  });
});

describe("capability gating", () => {
  it("shows staff Home, Jobs, Schedule, Documents, Team and their own menu, and no Settings", () => {
    const k = keys(viewer("staff"));
    expect(k).toEqual(expect.arrayContaining(["home", "jobs", "schedule", "documents", "team", "card", "timesheet", "leave", "expenses"]));
    expect(k).not.toContain("settings");
    expect(keys(viewer("admin"))).toContain("settings");
  });

  it("shows the Library to whoever has Tiff's documents or the field tools", () => {
    expect(keys({ caps: resolve("staff", { tiff: false, toolbox: true }), role: "staff" })).toContain("tiffkb");
    expect(keys({ caps: resolve("staff", { tiff: true, toolbox: false }), role: "staff" })).toContain("tiffkb");
    expect(keys({ caps: resolve("staff", { tiff: false, toolbox: false }), role: "staff" })).not.toContain("tiffkb");
  });

  it("hides Jobs and the Schedule without the workboard grant", () => {
    const k = keys({ caps: resolve("staff", { workboard: false }), role: "staff" });
    expect(k).not.toContain("jobs");
    expect(k).not.toContain("schedule");
    expect(k).toContain("home");
  });

  it("offers Reports to whoever holds the jobs' money, and no one else", () => {
    expect(keys(viewer("admin"))).not.toContain("reports");
    expect(keys({ caps: resolve("admin", { workboard_money: true }), role: "admin" })).toContain("reports");
    expect(keys(viewer("owner"))).toContain("reports");
  });

  it("shows a signed-out viewer only the ungated ones", () => {
    const k = keys(viewer(null));
    for (const gated of ["jobs", "schedule", "documents", "tiffkb", "design", "conversations", "settings", "reports"]) expect(k).not.toContain(gated);
    expect(k).toEqual(expect.arrayContaining(["home", "team", "timesheet"]));
  });

  it("drops a group left empty, never the ones with something in", () => {
    expect(navGroupsFor(viewer("staff")).map((g) => g.label)).toEqual(["Places", "Yours"]);
    expect(navGroupsFor(viewer("staff")).every((g) => g.items.length > 0)).toBe(true);
  });

  it("names only real capabilities", () => {
    for (const n of NAV) {
      if (n.capability) expect(CAPABILITIES).toContain(n.capability);
      for (const c of n.anyOf ?? []) expect(CAPABILITIES).toContain(c);
    }
  });
});

describe("isActive", () => {
  it("lights Home only on its own address, and a place on its nested pages", () => {
    expect(isActive(byKey("home"), "/dashboard")).toBe(true);
    expect(isActive(byKey("home"), "/dashboard/team")).toBe(false);
    expect(isActive(byKey("team"), "/dashboard/team/jordan-mills")).toBe(true);
    expect(isActive(byKey("jobs"), "/dashboard/jobs/abc")).toBe(true);
    expect(isActive(byKey("timesheet"), "/dashboard/my-leave")).toBe(false);
  });
});

describe("screenLabelFor — the screen Tiff is told the person is on", () => {
  it("names the screen by its most exact link", () => {
    expect(screenLabelFor("/dashboard")).toBe("Home");
    expect(screenLabelFor("/dashboard/jobs/abc")).toBe("Jobs");
    expect(screenLabelFor("/dashboard/tiff/library")).toBe("Library");
    expect(screenLabelFor("/dashboard/my-timesheet")).toBe("Timesheet");
  });

  it("names a page a place has taken in by that place", () => {
    expect(screenLabelFor("/dashboard/workboard/projects/p-1")).toBe("Jobs");
    expect(screenLabelFor("/dashboard/toolbox/heat-load")).toBe("Library");
  });

  it("is nothing off the nav", () => {
    expect(screenLabelFor("/handover/abc")).toBe("");
  });
});
