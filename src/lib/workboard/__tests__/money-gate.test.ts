/* The money gate, tested where it actually lives: in the QUERY, not the view.

   The claim this file defends is narrow and load-bearing — without capability
   `workboard_money` there is no money in the payload at all. Not money the
   components decline to draw, not money behind a CSS rule: no budget column
   selected, no variations query, no claims query. A component that forgets to
   check therefore cannot leak anything, because there is nothing to leak. */

const queries: { table: string; columns: string }[] = [];

/* The org MUST own a project, or the loader short-circuits before it reaches
   any money query — and then "no claims query ran" passes for the wrong
   reason. Every other table answers empty; one project row is the whole
   fixture this needs. */
const PROJECT_ROW = {
  id: "p-1",
  name: "Belmont change-over",
  client_name: "Belmont",
  site_label: null,
  site_address: null,
  stage: "Pre-install",
  status: "active",
  blocked_reason: null,
  blocked_on: null,
  blocked_at: null,
  budget_cents: 5_235_000,
  budget_source: "manual",
  hours_budget: 60,
  promised_finish: null,
  defects_end: null,
  design_id: null,
  notes: null,
  created_at: "2026-07-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
};

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      const rows = () => (table === "projects" ? [PROJECT_ROW] : []);
      chain.select = (columns = "") => {
        queries.push({ table, columns: String(columns) });
        return chain;
      };
      chain.eq = self;
      chain.neq = self;
      chain.in = self;
      chain.not = self;
      chain.gte = self;
      chain.lt = self;
      chain.lte = self;
      chain.gt = self;
      chain.or = self;
      chain.order = self;
      chain.limit = self;
      chain.maybeSingle = async () => ({ data: null });
      chain.then = (res: (v: { data: unknown[] }) => unknown) =>
        Promise.resolve({ data: rows() }).then(res);
      return chain;
    },
  },
}));

jest.mock("@/lib/workboard/query", () => ({ getSm8Timezone: async () => "Australia/Sydney" }));

import { loadProjectsBoard } from "@/lib/workboard/projects-board-query";

const TODAY = "2026-08-12";

const ran = (table: string) => queries.filter((q) => q.table === table);
const columnsFor = (table: string) => ran(table).map((q) => q.columns).join(" ");

beforeEach(() => {
  queries.length = 0;
});

describe("loadProjectsBoard without money access", () => {
  it("never asks for a budget, a variation or a claim", async () => {
    await loadProjectsBoard("org-1", TODAY, { includeMoney: false });

    expect(columnsFor("projects")).not.toMatch(/budget_cents|budget_source/);
    expect(ran("project_variations")).toHaveLength(0);
    expect(ran("project_claims")).toHaveLength(0);
  });

  /* Hours are NOT money. A labour-burn budget is hours-vs-hours by design —
     the pricing-not-payroll boundary — so it stays with the board. */
  it("still reads the hours budget, which is not money", async () => {
    await loadProjectsBoard("org-1", TODAY, { includeMoney: false });
    expect(columnsFor("projects")).toMatch(/hours_budget/);
  });
});

describe("loadProjectsBoard with money access", () => {
  it("asks for all three", async () => {
    await loadProjectsBoard("org-1", TODAY, { includeMoney: true });

    expect(columnsFor("projects")).toMatch(/budget_cents/);
    expect(columnsFor("projects")).toMatch(/budget_source/);
    expect(ran("project_variations")).toHaveLength(1);
    expect(ran("project_claims")).toHaveLength(1);
  });

  /* The default is deliberately permissive: every pre-existing caller keeps
     working, and the ONE caller that must gate says so out loud. A default of
     false would blank a page the day someone forgot the flag, and a missing
     number is far harder to notice than an extra one. */
  it("defaults to including money when nobody says otherwise", async () => {
    await loadProjectsBoard("org-1", TODAY);
    expect(columnsFor("projects")).toMatch(/budget_cents/);
    expect(ran("project_claims")).toHaveLength(1);
  });
});
