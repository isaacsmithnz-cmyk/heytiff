/* Workboard actions. What matters: the two tiers are REAL (shape needs
   workboard_manage, ticking needs only workboard), every row is re-resolved
   inside the caller's org, junk enums die before a query runs, and creating
   a project seeds the default checklist. */

const inserts: { table: string; payload: unknown }[] = [];
const updates: { table: string; patch: Record<string, unknown>; filters: Record<string, unknown> }[] = [];
const deletes: { table: string; filters: Record<string, unknown> }[] = [];
const selects: string[] = [];

/** Per-table maybeSingle answers, set per test. */
let rows: Record<string, Record<string, unknown> | null> = {};

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = () => {
        selects.push(table);
        return chain;
      };
      chain.eq = (col: string, v: unknown) => {
        filters[col] = v;
        return chain;
      };
      chain.order = self;
      chain.limit = self;
      chain.maybeSingle = async () => ({ data: rows[table] ?? null });
      chain.insert = (payload: unknown) => {
        inserts.push({ table, payload });
        const after: Record<string, unknown> = {
          select: () => ({ single: async () => ({ data: { id: "p-new" }, error: null }) }),
          then: (res: (v: { error: unknown }) => unknown) =>
            Promise.resolve({ error: rows.__insert_error ?? null }).then(res),
        };
        return after;
      };
      chain.update = (patch: Record<string, unknown>) => {
        const u = { table, patch, filters };
        const sub: Record<string, unknown> = {};
        sub.eq = (col: string, v: unknown) => {
          u.filters = { ...u.filters, [col]: v };
          return sub;
        };
        sub.then = (res: (v: { error: null }) => unknown) => {
          updates.push(u);
          return Promise.resolve({ error: null }).then(res);
        };
        return sub;
      };
      chain.delete = () => {
        const d = { table, filters: { ...filters } };
        const sub: Record<string, unknown> = {};
        sub.eq = (col: string, v: unknown) => {
          d.filters[col] = v;
          return sub;
        };
        sub.then = (res: (v: { error: null }) => unknown) => {
          deletes.push(d);
          return Promise.resolve({ error: null }).then(res);
        };
        return sub;
      };
      return chain;
    },
  },
}));

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn(async () => ({ user: { sub: "auth0|me" }, orgId: "org-1" })) },
}));

let caps = new Set<string>();
jest.mock("@/lib/permissions-server", () => ({
  can: async (c: string) => caps.has(c),
}));

const searchMirrorJobs = jest.fn(async () => []);
jest.mock("@/lib/workboard/projects-query", () => ({
  staffIdFor: async () => "staff-1",
  searchMirrorJobs: (...a: unknown[]) => searchMirrorJobs(...(a as [])),
}));

import {
  attachJob,
  createProject,
  searchJobs,
  setProjectStage,
  toggleChecklistItem,
} from "../workboard";
import { DEFAULT_CHECKLIST } from "@/lib/workboard/stages";

beforeEach(() => {
  inserts.length = 0;
  updates.length = 0;
  deletes.length = 0;
  selects.length = 0;
  rows = {};
  caps = new Set(["workboard", "workboard_manage"]);
  searchMirrorJobs.mockClear();
});

describe("createProject", () => {
  it("creates and seeds the default checklist in one go", async () => {
    const res = await createProject({ name: "  Smith St change-over  " });
    expect(res).toEqual({ ok: true, id: "p-new" });

    const project = inserts.find((i) => i.table === "projects")!.payload as Record<string, unknown>;
    expect(project).toMatchObject({ org_id: "org-1", name: "Smith St change-over" });

    const seed = inserts.find((i) => i.table === "project_checklist_items")!
      .payload as Record<string, unknown>[];
    expect(seed).toHaveLength(DEFAULT_CHECKLIST.length);
    expect(seed[0]).toMatchObject({ org_id: "org-1", project_id: "p-new", sort: 0 });
  });

  it("refuses without workboard_manage — viewing the board is not shaping it", async () => {
    caps = new Set(["workboard"]);
    const res = await createProject({ name: "X" });
    expect(res.ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("a nameless project is refused before any write", async () => {
    expect((await createProject({ name: "   " })).ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });
});

describe("setProjectStage", () => {
  it("kills junk stages before a single query runs", async () => {
    const res = await setProjectStage("p-1", "Defects");
    expect(res.ok).toBe(false);
    expect(selects).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("moves a real stage on a project inside the caller's org", async () => {
    rows.projects = { id: "p-1" };
    const res = await setProjectStage("p-1", "Rough-in");
    expect(res.ok).toBe(true);
    expect(updates[0]).toMatchObject({
      table: "projects",
      patch: expect.objectContaining({ stage: "Rough-in" }),
      filters: { org_id: "org-1", id: "p-1" },
    });
  });
});

describe("toggleChecklistItem — the tick tier", () => {
  it("works with only `workboard`, and records who ticked", async () => {
    caps = new Set(["workboard"]);
    rows.project_checklist_items = { id: "i-1", project_id: "p-1" };
    const res = await toggleChecklistItem("i-1", true);
    expect(res.ok).toBe(true);
    expect(updates[0].patch).toMatchObject({ done: true, done_by: "staff-1" });
  });

  it("unticking clears the provenance too", async () => {
    caps = new Set(["workboard"]);
    rows.project_checklist_items = { id: "i-1", project_id: "p-1" };
    await toggleChecklistItem("i-1", false);
    expect(updates[0].patch).toMatchObject({ done: false, done_by: null, done_at: null });
  });

  it("no workboard at all → no tick", async () => {
    caps = new Set();
    const res = await toggleChecklistItem("i-1", true);
    expect(res.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });
});

describe("attachJob", () => {
  beforeEach(() => {
    rows.projects = { id: "p-1" };
  });

  it("typed mode: stores the number with no provider", async () => {
    const res = await attachJob("p-1", { jobNumber: " 1042 ", role: "install" });
    expect(res.ok).toBe(true);
    expect(inserts[0].payload).toMatchObject({
      org_id: "org-1",
      project_id: "p-1",
      job_number: "1042",
      provider: null,
      remote_id: null,
      role: "install",
    });
  });

  it("picker mode: the mirror row inside THIS org is the target, and its number wins", async () => {
    rows.sm8_jobs = { uuid: "j-9", generated_job_id: "2001" };
    const res = await attachJob("p-1", { remoteId: "j-9", jobNumber: "ignored", role: "quote" });
    expect(res.ok).toBe(true);
    expect(inserts[0].payload).toMatchObject({
      provider: "servicem8",
      remote_id: "j-9",
      job_number: "2001",
      role: "quote",
    });
  });

  it("a remote id that isn't in this org's mirror attaches nothing", async () => {
    rows.sm8_jobs = null;
    const res = await attachJob("p-1", { remoteId: "someone-elses" });
    expect(res.ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("junk roles quietly become 'other' rather than failing the attach", async () => {
    await attachJob("p-1", { jobNumber: "7", role: "boss-job" });
    expect(inserts[0].payload).toMatchObject({ role: "other" });
  });

  it("nothing typed, nothing picked → told plainly", async () => {
    const res = await attachJob("p-1", {});
    expect(res.ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });
});

describe("searchJobs", () => {
  it("is manage-gated — the results are the client book", async () => {
    caps = new Set(["workboard"]);
    expect(await searchJobs("smith")).toEqual([]);
    expect(searchMirrorJobs).not.toHaveBeenCalled();

    caps = new Set(["workboard", "workboard_manage"]);
    await searchJobs("smith");
    expect(searchMirrorJobs).toHaveBeenCalledWith("org-1", "smith");
  });
});
