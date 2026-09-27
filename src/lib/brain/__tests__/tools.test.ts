/* The brain's hands, held still.

   What these pin: every tool is READ ONLY and org-scoped; jobHistory returns
   compact, capped shapes; the registry dispatches by name and turns failures
   into error VALUES (a throw inside an agentic loop kills the whole answer);
   and the tool definitions are API-shaped so the future ask-loop can hand
   them straight to the model. */

let lists: Record<string, Record<string, unknown>[]> = {};
let rows: Record<string, Record<string, unknown> | null> = {};
/** `.is(col, null)` filters asked for, as `table.col`. */
const tombstoneFilters: string[] = [];
/** `.eq(col, value)` filters asked for, as `table.col=value`. */
const eqFilters: string[] = [];

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = self;
      chain.eq = (col: string, value: unknown) => {
        eqFilters.push(`${table}.${col}=${value}`);
        return chain;
      };
      chain.in = self;
      chain.is = (col: string) => {
        tombstoneFilters.push(`${table}.${col}`);
        return chain;
      };
      chain.order = self;
      chain.limit = self;
      chain.maybeSingle = async () => ({ data: rows[table] ?? null });
      chain.then = (res: (v: { data: unknown[] }) => unknown) =>
        Promise.resolve({ data: lists[table] ?? [] }).then(res);
      return chain;
    },
  },
}));

/* A hit as the attach picker has it: the job known by its ServiceM8 uuid,
   `remoteId`, beside the client's company uuid. */
const searchMirrorJobs = jest.fn(async () => [
  {
    remoteId: "sm8-uuid-3323",
    jobNumber: "3323",
    status: "Work Order",
    clientName: "Meridian Data",
    companyId: "sm8-co-9",
    suburb: "Randwick",
    address: "2 Spring St\nRandwick NSW 2031",
    description: "Supply and install 12.5kW ducted",
    linkedTo: [],
  },
]);
jest.mock("@/lib/workboard/projects-query", () => ({
  searchMirrorJobs: (...a: unknown[]) => searchMirrorJobs(...(a as [])),
}));

const retrieveForQuestion = jest.fn(async () => ({
  chunks: [
    {
      title: "Clearing an E6",
      category: "field",
      heading: "Learned on the job — Lyle, Wed 6 Aug",
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

import { jobHistory, openTaskLoad } from "../tools";
import { TIFF_TOOLS, runTool as run, toolDefs, type Viewer } from "@/lib/tiff/registry";

/* The reads now live in Tiff's registry and run with a viewer (lib/tiff/
   registry); these tests reach them the way the ask loop does. */
const VIEWER: Viewer = {
  orgId: "org-1",
  userId: "auth0|u1",
  staffId: null,
  role: "owner",
  caps: new Set(["workboard", "tiff"]),
  tz: "Australia/Sydney",
  today: "2026-08-06",
};
const runTool = (name: string, input: Record<string, unknown>) => run(VIEWER, name, input, TIFF_TOOLS);
const BRAIN_TOOLS = TIFF_TOOLS;
/** What a read hands back, as the old registry's `result` did. */
const valueOf = (res: Awaited<ReturnType<typeof run>>) =>
  res.ok && res.outcome.kind === "result" ? res.outcome.value : undefined;

beforeEach(() => {
  lists = {};
  rows = {};
  eqFilters.length = 0;
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

  it("never grounds the router on a note somebody took back (two-way phase 2)", async () => {
    tombstoneFilters.length = 0;
    await jobHistory("org-1", { kind: "job", id: "j-1" });
    expect(tombstoneFilters).toEqual(["workboard_notes.removed_at"]);
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
      { id: "s-1", first_name: "Lyle", last_name: "Mercer", full_name: "Lyle Mercer" },
      { id: "s-2", first_name: "Dane", last_name: "P", full_name: "Dane P" },
    ];
    const load = await openTaskLoad("org-1", "2026-08-06");
    expect(load[0]).toMatchObject({ name: "Lyle Mercer", open: 3, overdue: 1 });
    expect(load[1]).toMatchObject({ open: 1, overdue: 0 });
  });
});

describe("the registry", () => {
  it("definitions are API-shaped — name, description, input_schema", () => {
    for (const def of toolDefs(TIFF_TOOLS)) {
      expect(def.name).toBeTruthy();
      expect(def.description.length).toBeGreaterThan(20);
      expect(def.input_schema).toHaveProperty("type", "object");
    }
  });

  it("dispatches by name", async () => {
    const res = await runTool("search_jobs", { query: "meridian" });
    expect(res.ok).toBe(true);
    expect(searchMirrorJobs).toHaveBeenCalledWith("org-1", "meridian");
  });

  it("job_history takes every kind it can read — a ServiceM8 job included", () => {
    /* The job sheet aims the Tiff modal at `job`, and the system prompt tells
       the loop to call job_history with whatever it is aimed at. An enum
       without `job` is a tool the model is told to call and can't. */
    const tool = BRAIN_TOOLS.find((t) => t.name === "job_history")!;
    const kind = (tool.inputSchema.properties as Record<string, { enum: string[] }>).kind;
    expect(kind.enum).toEqual(["project", "visit", "agreement", "job"]);
  });

  it("a search_jobs hit carries the kind and id job_history takes, not the picker's remoteId", async () => {
    const res = await runTool("search_jobs", { query: "meridian" });
    expect(res.ok).toBe(true);
    expect(valueOf(res)).toEqual([
        {
          kind: "job",
          id: "sm8-uuid-3323",
          jobNumber: "3323",
          status: "Work Order",
          clientName: "Meridian Data",
          suburb: "Randwick",
          address: "2 Spring St\nRandwick NSW 2031",
          description: "Supply and install 12.5kW ducted",
          linkedTo: [],
        },
      ]);
  });

  it("handing a search hit straight to job_history reads that mirror job by its uuid", async () => {
    /* The round trip the loop makes: search, then read one in depth. The hit
       must fit job_history's own schema as it stands, and land on the
       ServiceM8 row — its description is the job's own words. */
    const found = await runTool("search_jobs", { query: "3323" });
    const [hit] = valueOf(found) as { kind: string; id: string }[];
    const schema = BRAIN_TOOLS.find((t) => t.name === "job_history")!.inputSchema;
    expect((schema.properties as Record<string, { enum: string[] }>).kind.enum).toContain(hit.kind);

    rows.sm8_jobs = { job_description: "Supply and install 12.5kW ducted" };
    const res = await runTool("job_history", { kind: hit.kind, id: hit.id });
    expect(valueOf(res)).toMatchObject({ jobNotes: "Supply and install 12.5kW ducted" });
    expect(eqFilters).toContain("sm8_jobs.uuid=sm8-uuid-3323");
    expect(eqFilters).toContain("workboard_notes.target_kind=job");
  });

  it("an unknown tool is an error value the loop can show the model — never a throw", async () => {
    const res = await runTool("drop_tables", {});
    expect(res).toEqual({ ok: false, error: "No such tool: drop_tables" });
  });

  it("a tool blowing up is contained the same way", async () => {
    retrieveForQuestion.mockRejectedValueOnce(new Error("voyage down"));
    const res = await runTool("kb_search", { query: "E6" });
    expect(res).toEqual({ ok: false, error: "kb_search failed — answer without it." });
  });

  it("kb_search trims the retrieval to loop-sized excerpts", async () => {
    const res = await runTool("kb_search", { query: "E6" });
    expect(res.ok).toBe(true);
    const items = valueOf(res) as Record<string, unknown>[];
    expect(items[0]).toMatchObject({
      title: "Clearing an E6",
      category: "field",
      heading: "Learned on the job — Lyle, Wed 6 Aug",
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
