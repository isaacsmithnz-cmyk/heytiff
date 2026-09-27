/**
 * @jest-environment node
 */
/* MOVING THE SCREEN (universal Tiff 1B): where each tool may send the
   person, and who may be sent there. Every guard here was seen failing. */

/* A database that honours the org filter: a row is found only by its own
   org and id, so a record in another org is simply not there. */
type Row = Record<string, unknown> & { org_id: string };
let tables: Record<string, Row[]> = {};
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => {
          filters.push([col, val]);
          return q;
        },
        maybeSingle: async () => ({
          data: (tables[table] ?? []).find((r) => filters.every(([c, v]) => r[c] === v)) ?? null,
          error: null,
        }),
      };
      return q;
    },
  },
}));

const searchStaff = jest.fn(async () => [{ id: "s-1", name: "Dane Porter", known: null, initials: "DP", title: "Tech", active: true }]);
const searchClients = jest.fn(async () => [] as unknown[]);
const searchProjects = jest.fn(async () => [] as unknown[]);
jest.mock("@/lib/workboard/palette-query", () => ({
  searchStaff: (...a: unknown[]) => searchStaff(...(a as [])),
  searchClients: (...a: unknown[]) => searchClients(...(a as [])),
  searchProjects: (...a: unknown[]) => searchProjects(...(a as [])),
}));
const searchAllMirrorJobs = jest.fn(async () => [] as unknown[]);
jest.mock("@/lib/workboard/all-jobs-query", () => ({
  searchAllMirrorJobs: (...a: unknown[]) => searchAllMirrorJobs(...(a as [])),
}));

import { ALL_SCREENS } from "@/components/shell/nav";
import { TIFF_TOOLS, runTool, toolsFor, type Outcome, type Viewer } from "..";

const viewer = (caps: string[], role: Viewer["role"] = "staff"): Viewer => ({
  orgId: "org-1",
  userId: "auth0|u1",
  staffId: null,
  role,
  caps: new Set(caps) as Viewer["caps"],
  tz: "Australia/Sydney",
  today: "2026-09-27",
});

async function outcome(v: Viewer, name: string, input: Record<string, unknown>): Promise<Outcome> {
  const res = await runTool(v, name, input, toolsFor(v));
  if (!res.ok) throw new Error(res.error);
  return res.outcome;
}

beforeEach(() => {
  tables = {
    staff_profiles: [
      { org_id: "org-1", id: "s-1", first_name: "Dane", last_name: "Porter", full_name: "Dane Porter", preferred_name: null },
      { org_id: "org-2", id: "s-9", first_name: "Other", last_name: "Org", full_name: "Other Org", preferred_name: null },
    ],
    projects: [
      { org_id: "org-1", id: "p-1", name: "Harbour Rd fit-out" },
      { org_id: "org-2", id: "p-9", name: "Not ours" },
    ],
    sm8_companies: [
      { org_id: "org-1", uuid: "c-1", name: "Meridian Data" },
      { org_id: "org-2", uuid: "c-9", name: "Not ours" },
    ],
    sm8_jobs: [
      { org_id: "org-1", uuid: "j-1", generated_job_id: "1044", company_uuid: "c-1" },
      { org_id: "org-2", uuid: "j-9", generated_job_id: "9999", company_uuid: null },
    ],
  };
  jest.clearAllMocks();
});

describe("open_screen", () => {
  it("offers every screen's name to everyone, so the tool block is one for all", () => {
    const tool = TIFF_TOOLS.find((t) => t.name === "open_screen")!;
    const e = (tool.inputSchema.properties as Record<string, { enum: string[] }>).screen.enum;
    expect(e).toEqual(ALL_SCREENS.map((n) => n.label));
    // one of each: a repeated enum value is a schema the API may refuse
    expect(new Set(e).size).toBe(e.length);
  });

  it("moves to a screen the viewer may see, with its own line", async () => {
    expect(await outcome(viewer(["workboard"]), "open_screen", { screen: "Workboard" })).toEqual({
      kind: "screen",
      href: "/dashboard/workboard",
      label: "Workboard",
      line: "Opening the Workboard.",
    });
  });

  it("goes Home, whose address is the dashboard itself", async () => {
    expect(await outcome(viewer([]), "open_screen", { screen: "Home" })).toMatchObject({ href: "/dashboard" });
  });

  it("refuses in words a screen the viewer can't see, and moves nowhere", async () => {
    const o = await outcome(viewer(["workboard"]), "open_screen", { screen: "Time & Pay" });
    expect(o.kind).toBe("result");
    expect(JSON.stringify(o)).toContain("can't open Time & Pay");
  });
});

describe("find_record", () => {
  it("finds people only for a viewer with team, and says why not to one without", async () => {
    const without = await outcome(viewer(["workboard"]), "find_record", { query: "dane", kinds: ["staff"] });
    expect(without).toEqual({ kind: "result", value: [{ kind: "staff", reason: "not allowed" }] });
    expect(searchStaff).not.toHaveBeenCalled();

    const withTeam = await outcome(viewer(["team"]), "find_record", { query: "dane", kinds: ["staff"] });
    expect(withTeam).toEqual({
      kind: "result",
      value: [{ kind: "staff", id: "s-1", label: "Dane Porter", detail: "Tech" }],
    });
  });

  it("says it couldn't check, apart from finding nothing, when a search throws", async () => {
    searchClients.mockRejectedValueOnce(new Error("down"));
    const o = await outcome(viewer(["workboard"]), "find_record", { query: "meridian", kinds: ["client", "project"] });
    expect((o as { value: unknown[] }).value).toEqual(
      expect.arrayContaining([{ kind: "client", reason: "couldn't check" }])
    );
  });
});

describe("open_record", () => {
  it("opens each kind at its link, named from the record, not the request", async () => {
    const all = viewer(["team", "workboard"]);
    expect(await outcome(all, "open_record", { kind: "staff", id: "s-1" })).toMatchObject({
      href: "/dashboard/team/s-1",
      label: "Dane Porter's card",
    });
    expect(await outcome(all, "open_record", { kind: "project", id: "p-1" })).toMatchObject({
      href: "/dashboard/workboard/projects/p-1",
      label: "Harbour Rd fit-out",
    });
    expect(await outcome(all, "open_record", { kind: "client", id: "c-1" })).toMatchObject({
      href: "/dashboard/workboard?q=Meridian%20Data",
    });
    expect(await outcome(all, "open_record", { kind: "job", id: "j-1" })).toMatchObject({
      href: "/dashboard/workboard?job=j-1",
      label: "#1044 — Meridian Data",
    });
  });

  it("finds nothing in another org, for every kind", async () => {
    const all = viewer(["team", "workboard"]);
    for (const [kind, id] of [["staff", "s-9"], ["project", "p-9"], ["client", "c-9"], ["job", "j-9"]]) {
      const o = await outcome(all, "open_record", { kind, id });
      expect(o.kind).toBe("result");
    }
  });

  it("refuses a staff card to a viewer without team", async () => {
    const o = await outcome(viewer(["workboard"]), "open_record", { kind: "staff", id: "s-1" });
    expect(o.kind).toBe("result");
    expect(JSON.stringify(o)).toContain("staff cards");
  });

  it("never hands back an address outside the nav and the record links", async () => {
    const allowed = new Set(ALL_SCREENS.map((n) => n.href));
    const all = viewer(["team", "workboard", "tiff", "timepay_all", "assets_all", "toolbox", "studio"], "owner");
    const moves: string[] = [];
    for (const n of ALL_SCREENS) {
      const o = await outcome(all, "open_screen", { screen: n.label });
      if (o.kind === "screen") moves.push(o.href);
    }
    for (const [kind, id] of [["staff", "s-1"], ["project", "p-1"], ["client", "c-1"], ["job", "j-1"]]) {
      const o = await outcome(all, "open_record", { kind, id });
      if (o.kind === "screen") moves.push(o.href);
    }
    const record = /^\/dashboard\/(team\/[^/?]+|workboard\?(job|q)=[^&]+|workboard\/projects\/[^/?]+)$/;
    for (const href of moves) expect(allowed.has(href) || record.test(href)).toBe(true);
    expect(moves.length).toBeGreaterThan(ALL_SCREENS.length - 2);
  });
});
