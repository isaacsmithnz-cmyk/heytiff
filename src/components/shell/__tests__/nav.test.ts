import {
  NAV,
  NAV_GROUPS,
  NAV_ROWS,
  isActive,
  navFor,
  navGroupsFor,
  type NavItem,
  type NavViewer,
} from "../nav";
import { CAPABILITIES, resolve } from "@/lib/permissions";
import type { Role } from "@/lib/roles-shared";

const byKey = (key: string) => NAV.find((n) => n.key === key) as NavItem;

describe("nav config", () => {
  it("flattens groups into NAV_ROWS — one row per entry", () => {
    const flatFromGroups = NAV_GROUPS.flatMap((g) => g.items);
    expect(NAV_ROWS).toHaveLength(flatFromGroups.length);
    expect(NAV_ROWS.map((n) => n.key)).toEqual(flatFromGroups.map((n) => n.key));
  });

  it("NAV additionally carries the tabbed faces, each right after its parent", () => {
    // The rail draws rows; ⌘K searches everything, folded-in faces included.
    expect(NAV.map((n) => n.key)).toEqual(
      NAV_ROWS.flatMap((n) => [n.key, ...(n.subItems ?? []).map((s) => s.key)])
    );
    expect(NAV.map((n) => n.key)).toContain("myleave");
    expect(NAV_ROWS.map((n) => n.key)).not.toContain("myleave");
  });

  it("leaves no dashboard screen without a door", () => {
    /* THE ORPHAN GUARD. The audit found two daily surfaces reachable from
       nowhere in the shell: the noticeboard (one card on Home) and the
       action-required board (two hero counters). Neither was in the rail and
       neither was in ⌘K, so typing "notices" or "action" returned "no results"
       for screens that very much existed.

       Listed by hand rather than crawled off the filesystem: some routes are
       genuinely details of another screen (a staff card, a project, an
       agreement) and should NOT own a nav entry. This is the set that has to,
       and a new top-level screen is meant to fail here until someone decides
       which it is. */
    const mustBeFindable = [
      "/dashboard",
      "/dashboard/action-required",
      "/dashboard/notices",
      "/dashboard/workboard",
      "/dashboard/toolbox",
      "/dashboard/studio",
      "/dashboard/tiff",
      "/dashboard/tiff/library",
      "/dashboard/my-timesheet",
      "/dashboard/my-leave",
      "/dashboard/my-vehicle",
      "/dashboard/my-expenses",
      "/dashboard/team",
      "/dashboard/timepay",
      "/dashboard/assets",
      "/dashboard/admin",
    ];
    const known = new Set(NAV.map((n) => n.href));
    expect(mustBeFindable.filter((h) => !known.has(h))).toEqual([]);
  });

  it("gives the noticeboard a row of its own and Action required a face of Home", () => {
    // a row, because it is a daily read; a face, because the hero counters
    // above it are the summary of the very same list
    expect(NAV_ROWS.map((n) => n.key)).toContain("notices");
    expect(byKey("home").subItems?.map((s) => s.href)).toEqual(["/dashboard/action-required"]);
    expect(NAV_ROWS.map((n) => n.key)).not.toContain("actionreq");
    // …and Home stays lit while you are reading it
    expect(isActive(byKey("home"), "/dashboard/action-required")).toBe(true);
  });

  it("folds the library into Tiff AI rather than giving it a rail row", () => {
    // one feature seen from both ends: the assistant answers out of the
    // library. The row stays lit on the library, and ⌘K still finds it.
    const tiff = byKey("tiff");
    expect(tiff.subItems?.map((s) => s.href)).toEqual(["/dashboard/tiff/library"]);
    expect(NAV_ROWS.map((n) => n.key)).not.toContain("tiffkb");
    expect(NAV.map((n) => n.key)).toContain("tiffkb");
    expect(isActive(tiff, "/dashboard/tiff/library")).toBe(true);
  });

  it("gives no tabbed face a capability of its own", () => {
    // A face is offered exactly when its parent is — anything needing its own
    // gate is an entry, not a face. The type forbids it; this says why.
    for (const n of NAV_ROWS) {
      for (const s of n.subItems ?? []) {
        expect(s).not.toHaveProperty("capability");
        expect(s).not.toHaveProperty("minRole");
      }
    }
  });

  it("has unique keys and hrefs under /dashboard", () => {
    const keys = NAV.map((n) => n.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const n of NAV) {
      expect(n.href.startsWith("/dashboard")).toBe(true);
    }
  });

  it("orders the rail Workspace, then Personal, then Operations", () => {
    // Personal sits above Operations: everyone has personal screens,
    // only some people manage.
    expect(NAV_GROUPS.map((g) => g.label)).toEqual(["Workspace", "Personal", "Operations"]);
  });

  it("groups the operations section as designed", () => {
    const ops = NAV_GROUPS.find((g) => g.label === "Operations");
    expect(ops?.items.map((i) => i.key)).toEqual(["people", "timepay", "assets", "admin"]);
  });

  it("opens Workspace with Home then the Workboard", () => {
    // The two questions anyone opens the app to ask, in order: what's on for
    // ME, and what's on for the BUSINESS. Everything else is a tool.
    const ws = NAV_GROUPS.find((g) => g.label === "Workspace");
    // Home (your day) → Workboard (the business's) → Noticeboard (the team's),
    // then the tools you go and use.
    expect(ws?.items.map((i) => i.key)).toEqual([
      "home",
      "workboard",
      "notices",
      "toolbox",
      "ductr",
      "tiff",
    ]);
    expect(ws?.items[0].label).toBe("Home");
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

  it("shows the Workboard to staff — it's their board, by default", () => {
    expect(keys(viewer("staff"))).toContain("workboard");
    expect(keys(viewer(null))).not.toContain("workboard");
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
    /* Faces are read off their PARENT, not off themselves: a face never
       carries a capability (pinned above), so counting NAV directly would
       call the knowledge base ungated when Tiff AI gates it. */
    const ungated = NAV_ROWS.filter((n) => !n.capability && !n.minRole).flatMap((n) => [
      n.key,
      ...(n.subItems ?? []).map((s) => s.key),
    ]);
    // your own vehicle is intrinsic, like your own timesheet will be
    expect(ungated).toEqual(expect.arrayContaining(["home", "myvehicle"]));
    for (const role of ["staff", "admin", "owner", null] as const) {
      expect(keys(viewer(role))).toEqual(expect.arrayContaining(ungated));
    }
  });

  it("keeps groups but drops those emptied by filtering", () => {
    // Staff hold nothing in Operations any more — the Workboard moved up to
    // Workspace — so the whole group falls away for them.
    const groups = navGroupsFor(viewer("staff"));
    expect(groups.map((g) => g.label)).toEqual(["Workspace", "Personal"]);
    expect(groups.find((g) => g.label === "Personal")?.items.map((i) => i.key)).toEqual([
      "mytimesheet",
      "myvehicle",
      "myexpenses",
    ]);
    expect(groups.every((g) => g.items.length > 0)).toBe(true);

    // …and an admin, who does hold Operations entries, keeps the group.
    expect(navGroupsFor(viewer("admin")).map((g) => g.label)).toEqual([
      "Workspace",
      "Personal",
      "Operations",
    ]);
  });

  it("puts the Workboard second in Workspace, right under Home", () => {
    // Home is your day, the Workboard is the business's — the pair sits at
    // the top of the rail, and revoking the capability leaves Home alone.
    const workspace = (v: NavViewer) =>
      navGroupsFor(v).find((g) => g.label === "Workspace")?.items.map((i) => i.key);
    expect(workspace(viewer("staff"))?.slice(0, 2)).toEqual(["home", "workboard"]);
    expect(workspace(viewer("owner"))?.slice(0, 2)).toEqual(["home", "workboard"]);
    expect(workspace({ caps: resolve("staff", { workboard: false }), role: "staff" })).toEqual([
      "home",
      // the noticeboard is ungated, so revoking the workboard never hides it
      "notices",
      "toolbox",
      "ductr",
      "tiff",
    ]);
  });

  it("Personal is ungated — every viewer keeps their own timesheet, vehicle and expenses", () => {
    for (const role of ["staff", "admin", "owner"] as const) {
      expect(navGroupsFor(viewer(role)).find((g) => g.label === "Personal")?.items.map((i) => i.key))
        .toEqual(["mytimesheet", "myvehicle", "myexpenses"]);
      // …and leave stays reachable from ⌘K, riding on the timesheet entry
      expect(navFor(viewer(role)).map((n) => n.key)).toContain("myleave");
    }
    // revoking the team-wide screens doesn't touch your own
    expect(keys({ caps: resolve("owner", { assets_all: false, timepay_all: false }), role: "owner" }))
      .toEqual(expect.arrayContaining(["mytimesheet", "myvehicle"]));
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

  it("keeps an entry lit on its tabbed faces — the row is the section", () => {
    // Without this the rail would go dark the moment you hit the Leave tab,
    // reading as "you have navigated out of Timesheet" when you have not.
    const sheet = byKey("mytimesheet");
    expect(isActive(sheet, "/dashboard/my-timesheet")).toBe(true);
    expect(isActive(sheet, "/dashboard/my-leave")).toBe(true);
    expect(isActive(sheet, "/dashboard/my-expenses")).toBe(false);
    expect(isActive(sheet, "/dashboard/timepay/leave")).toBe(false);
  });

  it("does not let a face bleed onto a neighbouring entry", () => {
    // /dashboard/my-leave must not also light Vehicle or Expenses.
    for (const key of ["myvehicle", "myexpenses"]) {
      expect(isActive(byKey(key), "/dashboard/my-leave")).toBe(false);
    }
  });
});
