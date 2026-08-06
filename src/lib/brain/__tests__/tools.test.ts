/* The brain's hands, held still.

   What these pin: every tool is READ ONLY and org-scoped; jobHistory returns
   compact, capped shapes; the registry dispatches by name and turns failures
   into error VALUES (a throw inside an agentic loop kills the whole answer);
   and the tool definitions are API-shaped so the future ask-loop can hand
   them straight to the model. */

let lists: Record<string, Record<string, unknown>[]> = {};
let rows: Record<string, Record<string, unknown> | null> = {};

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = self;
      chain.eq = self;
      chain.in = self;
      chain.order = self;
      chain.limit = self;
      chain.maybeSingle = async () => ({ data: rows[table] ?? null });
      chain.then = (res: (v: { data: unknown[] }) => unknown) =>
        Promise.resolve({ data: lists[table] ?? [] }).then(res);
      return chain;
    },
  },
}));

const searchMirrorJobs = jest.fn(async () => [{ id: "j-1", label: "Meridian" }]);
jest.mock("@/lib/workboard/projects-query", () => ({
  searchMirrorJobs: (...a: unknown[]) => searchMirrorJobs(...(a as [])),
}));

const retrieveForQuestion = jest.fn(async () => ({
  chunks: [
    {
      title: "Clearing an E6",
      category: "field",
      heading: "Learned on the job — Luke, Wed 6 Aug",
      pageFrom: 1,
      pageTo: 1,
      content: "Power the outdoor board separately.",
    },
  ],
  trace: {},
  sources: [],
}));
jest.mock("@/lib/tiff/retrieve", () => ({
  retrieveForQuestion: (...a: unknown[]) => retrieveForQuestion(...(a as [])),
}));

import { BRAIN_TOOLS, jobHistory, openTaskLoad, runTool, toolDefs } from "../tools";

beforeEach(() => {
  lists = {};
  rows = {};
  searchMirrorJobs.mockClear();
});

describe("jobHistory", () => {
  it("reads the job's whole memory in one shape", async () => {
    lists.workboard_issues = [
      {
        id: "i-1",
        summary: "Middle rooftop unit tripping",
        equipment_ref: "RTU-2",
        occurrences: 3,
        first_seen: "2026-07-01",
        last_seen: "2026-08-02",
      },
    ];
    lists.workboard_flags = [{ message: "No roof access", severity: "urgent" }];
    lists.workboard_notes = [{ transcript: "swapped the belts" }];
    lists.project_equipment = [{ description: "Rooftop package unit", model: "PUZ-ZM250" }];
    rows.projects = { notes: "gate code 4417" };

    const h = await jobHistory("org-1", { kind: "project", id: "p-1" });
    expect(h).toEqual({
      issues: [
        {
          summary: "Middle rooftop unit tripping",
          equipmentRef: "RTU-2",
          occurrences: 3,
          lastSeen: "2026-08-02",
        },
      ],
      flags: [{ message: "No roof access", severity: "urgent" }],
      recentNotes: ["swapped the belts"],
      equipment: ["Rooftop package unit PUZ-ZM250"],
      jobNotes: "gate code 4417",
    });
  });

  it("a visit has no equipment register and that is not an error", async () => {
    rows.maintenance_visits = { notes: null };
    const h = await jobHistory("org-1", { kind: "visit", id: "v-1" });
    expect(h.equipment).toEqual([]);
    expect(h.jobNotes).toBeNull();
  });

  it("no target, no reads — an empty memory, instantly", async () => {
    const h = await jobHistory("org-1", { kind: "none" });
    expect(h).toEqual({ issues: [], flags: [], recentNotes: [], equipment: [], jobNotes: null });
  });
});

describe("openTaskLoad", () => {
  it("groups by person, heaviest first, and counts overdue against the org's own today", async () => {
    lists.tasks = [
      { assigned_to: "s-1", due_date: "2026-08-01" },
      { assigned_to: "s-1", due_date: null },
      { assigned_to: "s-1", due_date: "2026-09-01" },
      { assigned_to: "s-2", due_date: null },
    ];
    lists.staff_profiles = [
      { id: "s-1", first_name: "Luke", last_name: "Mercer", full_name: "Luke Mercer" },
      { id: "s-2", first_name: "Dane", last_name: "P", full_name: "Dane P" },
    ];
    const load = await openTaskLoad("org-1", "2026-08-06");
    expect(load[0]).toMatchObject({ name: "Luke Mercer", open: 3, overdue: 1 });
    expect(load[1]).toMatchObject({ open: 1, overdue: 0 });
  });
});

describe("the registry", () => {
  it("definitions are API-shaped — name, description, input_schema", () => {
    for (const def of toolDefs()) {
      expect(def.name).toBeTruthy();
      expect(def.description.length).toBeGreaterThan(20);
      expect(def.input_schema).toHaveProperty("type", "object");
    }
  });

  it("dispatches by name", async () => {
    const res = await runTool("org-1", "search_jobs", { query: "meridian" });
    expect(res).toEqual({ ok: true, result: [{ id: "j-1", label: "Meridian" }] });
    expect(searchMirrorJobs).toHaveBeenCalledWith("org-1", "meridian");
  });

  it("an unknown tool is an error value the loop can show the model — never a throw", async () => {
    const res = await runTool("org-1", "drop_tables", {});
    expect(res).toEqual({ ok: false, error: "No such tool: drop_tables" });
  });

  it("a tool blowing up is contained the same way", async () => {
    retrieveForQuestion.mockRejectedValueOnce(new Error("voyage down"));
    const res = await runTool("org-1", "kb_search", { query: "E6" });
    expect(res).toEqual({ ok: false, error: "kb_search failed — answer without it." });
  });

  it("kb_search trims the retrieval to loop-sized excerpts", async () => {
    const res = await runTool("org-1", "kb_search", { query: "E6" });
    expect(res.ok).toBe(true);
    const items = (res as { ok: true; result: unknown }).result as Record<string, unknown>[];
    expect(items[0]).toMatchObject({
      title: "Clearing an E6",
      category: "field",
      heading: "Learned on the job — Luke, Wed 6 Aug",
      pages: "1",
    });
  });

  it("EVERY tool is a reader — the registry contains no writes", () => {
    /* The safety model in one assertion: understanding is probabilistic,
       effect is deterministic, and effect goes through the review card. If
       this test is failing, someone added a write tool — don't. */
    const names = BRAIN_TOOLS.map((t) => t.name).join(" ");
    expect(names).not.toMatch(/create|update|delete|insert|apply|publish|set_/);
  });
});
