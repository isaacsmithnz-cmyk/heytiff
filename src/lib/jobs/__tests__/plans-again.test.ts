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

const doc = (id: string, size: number): Row => ({ org_id: "org-1", id, file_name: "307 Coonawarra Rd_CDC.pdf", storage_ref: `org-1/${id}.pdf`, mime_type: "application/pdf", size_bytes: size, sm8_job_uuid: "job-3570", uploaded_at: "2026-11-19T21:47:52Z" });

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  tables.documents = [doc("d-1", 11271429), doc("d-2", 11271429), doc("d-3", 512)];
  tables.job_plans = [{ id: "jplan_1", org_id: "org-1", job_uuid: "job-3570", document_id: "d-1", attachment_id: null, name: "307 Coonawarra Rd_CDC.pdf", state: "failed", said: "Failed to fetch", claimed_at: "2026-11-19T21:48:04Z" }];
});

describe("reading a plan again", () => {
  it("puts a failed plan back to reading, its reason and claim cleared", async () => {
    expect(await readPlanAgain("org-1", "job-3570", "jplan_1")).toBe(true);
    expect(tables.job_plans![0]).toMatchObject({ state: "reading", said: null, claimed_at: null });
  });

  it("leaves a plan that isn't failed, or is another job's", async () => {
    expect(await readPlanAgain("org-1", "job-9999", "jplan_1")).toBe(false);
    tables.job_plans![0]!.state = "read";
    expect(await readPlanAgain("org-1", "job-3570", "jplan_1")).toBe(false);
    expect(tables.job_plans![0]!.state).toBe("read");
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
