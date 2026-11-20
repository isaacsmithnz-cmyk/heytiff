/** @jest-environment node */
/* A plan read again, and the same file kept out of Plans twice
   (plans-server.ts readPlanAgain, addJobPlans). 3570, 20 November 2026:
   Luke's set went into Plans twice and both failed before the fix, with no
   way to read either again. The database is a fake. */

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};

jest.mock("server-only", () => ({}));
jest.mock("@/lib/studio/pdf-render", () => ({ printBase: (o: string) => o, launchHeadless: async () => ({}) }));
jest.mock("@/lib/studio/pdf-request", () => ({ signPlanPagesTicket: () => "signed" }));
jest.mock("@/lib/supabase-server", () => {
  const query = (table: string) => {
    const filters: [string, unknown][] = [];
    let update: Row | null = null;
    let insert: Row | null = null;
    const rows = () => (tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push([c, v]), q),
      not: () => q,
      update: (r: Row) => ((update = r), q),
      insert: (r: Row) => ((insert = r), q),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
        if (insert) (tables[table] ??= []).push(insert);
        const hit = rows();
        if (update) for (const r of hit) Object.assign(r, update);
        return Promise.resolve({ data: insert ? [insert] : hit, error: null }).then(res, rej);
      },
    };
    return q;
  };
  return { supabaseAdmin: { from: query } };
});

import { addJobPlans, readPlanAgain } from "../plans-server";
import { planProgressOf } from "../plans";

const doc = (id: string, size: number): Row => ({ org_id: "org-1", id, file_name: "307 Coonawarra Rd_CDC.pdf", storage_ref: `org-1/${id}.pdf`, mime_type: "application/pdf", size_bytes: size, sm8_job_uuid: "job-3570", uploaded_at: "2026-11-19T21:47:52Z" });

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  tables.documents = [doc("d-1", 11271429), doc("d-2", 11271429), doc("d-3", 512)];
  tables.job_plans = [{ id: "jplan_1", org_id: "org-1", job_uuid: "job-3570", document_id: "d-1", attachment_id: null, name: "307 Coonawarra Rd_CDC.pdf", state: "failed", said: "Failed to fetch", claimed_at: "2026-11-19T21:48:04Z" }];
});

describe("reading a plan again", () => {
  it("puts a failed plan back to reading, its reason and claim cleared", async () => {
    expect(await readPlanAgain("org-1", "job-3570", "jplan_1")).toBe(true);
    expect(tables.job_plans![0]).toMatchObject({ state: "reading", said: null, claimed_at: null, progress: null });
  });

  it("reads a plan that was read afresh, from its first page", async () => {
    Object.assign(tables.job_plans![0]!, { state: "read", pages: [{ n: 13, kind: "floor" }], reading: { floors: {} }, page_count: 27, read_at: "2026-11-20T12:17:27Z" });
    expect(await readPlanAgain("org-1", "job-3570", "jplan_1")).toBe(true);
    expect(tables.job_plans![0]).toMatchObject({ state: "reading", pages: [], reading: null, page_count: 0, read_at: null });
  });

  it("leaves a plan being read, or another job's", async () => {
    expect(await readPlanAgain("org-1", "job-9999", "jplan_1")).toBe(false);
    tables.job_plans![0]!.state = "reading";
    expect(await readPlanAgain("org-1", "job-3570", "jplan_1")).toBe(false);
  });
});

describe("the same file into Plans twice", () => {
  it("is already there: the same name and size under another upload adds nothing", async () => {
    expect(await addJobPlans("org-1", "job-3570", [{ documentId: "d-2" }], "staff-1")).toEqual({ ok: true, planIds: [], already: 1 });
    expect(tables.job_plans).toHaveLength(1);
  });

  it("goes in when the name is the same but the file isn't", async () => {
    const out = await addJobPlans("org-1", "job-3570", [{ documentId: "d-3" }], "staff-1");
    expect(out.ok && out.planIds).toHaveLength(1);
    expect(tables.job_plans).toHaveLength(2);
  });
});

describe("the bar under a plan being read", () => {
  it("says each step in words and fills the bar in order", () => {
    expect(planProgressOf(null)).toBeNull();
    const steps = [
      planProgressOf({ step: "drawing", done: 0, total: 0 }),
      planProgressOf({ step: "drawing", done: 11, total: 27 }),
      planProgressOf({ step: "finding", done: 0, total: 1 }),
      planProgressOf({ step: "floors", done: 1, total: 3 }),
      planProgressOf({ step: "reading", done: 2, total: 5 }),
      planProgressOf({ step: "reading", done: 5, total: 5 }),
    ];
    expect(steps.map((s) => s!.words)).toEqual([
      "Opening the set",
      "Drawing page 12 of 27",
      "Finding the floors",
      "Drawing the floors in full, 2 of 3",
      "Reading the floors, roof and site, 2 of 5 done",
      "Putting the read together",
    ]);
    const pct = steps.map((s) => s!.percent);
    expect(pct).toEqual([...pct].sort((a, b) => a - b));
    expect(pct.at(-1)).toBeLessThan(100);
  });
});
