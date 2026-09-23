/* Paper on a ServiceM8 job — the last step of the Documents face's upload,
   and taking one of ours back off.

   What this pins is WHOSE row may move. An upload leaves a landed
   `job_document` that belongs to nobody; only the person who uploaded it may
   point it at a job, only at a job in this org's mirror, and never away from
   a job that already holds it. Removal touches only our kind: ServiceM8's
   cached copies are theirs. */

/* jest.setup stubs this module for every suite that renders the job card */
jest.unmock("@/app/actions/job-documents");

let capWorkboard = true;
let jobRow: Record<string, unknown> | null = { uuid: "job-1" };
let docRow: Record<string, unknown> | null = null;
let updated: Record<string, unknown>[] = [{ id: "d-9" }];

type Op = { table: string; op: string; filters: [string, string, unknown][]; values?: unknown };
const ops: Op[] = [];
const removed: string[][] = [];

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const op: Op = { table, op: "select", filters: [] };
      ops.push(op);
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.update = (values: unknown) => {
        op.op = "update";
        op.values = values;
        return q;
      };
      q.delete = () => {
        op.op = "delete";
        return q;
      };
      q.eq = (col: string, val: unknown) => {
        op.filters.push(["eq", col, val]);
        return q;
      };
      q.is = (col: string, val: unknown) => {
        op.filters.push(["is", col, val]);
        return q;
      };
      q.maybeSingle = async () => ({ data: table === "sm8_jobs" ? jobRow : docRow });
      q.then = (res: (v: unknown) => unknown) =>
        Promise.resolve(op.op === "update" ? { data: updated, error: null } : { error: null }).then(res);
      return q;
    },
    storage: {
      from: () => ({
        remove: async (refs: string[]) => {
          removed.push(refs);
          return { error: null };
        },
      }),
    },
  },
}));
jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn().mockResolvedValue({ user: { sub: "auth0|u" }, orgId: "org-1" }) },
}));
const can = jest.fn(async (cap: string) => cap === "workboard" && capWorkboard);
jest.mock("@/lib/permissions-server", () => ({ can: (cap: string) => can(cap) }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn(async () => "staff-1") }));

import { attachJobDocument, removeJobDocument } from "../job-documents";

const landed = (over: Record<string, unknown> = {}) => ({
  id: "d-9",
  kind: "job_document",
  uploaded_at: "2026-09-23T00:40:00Z",
  uploaded_by: "staff-1",
  sm8_job_uuid: null,
  storage_ref: "org/org-1/job_document/d-9.pdf",
  ...over,
});

const writes = () => ops.filter((o) => o.op !== "select");

beforeEach(() => {
  capWorkboard = true;
  jobRow = { uuid: "job-1" };
  docRow = landed();
  updated = [{ id: "d-9" }];
  ops.length = 0;
  removed.length = 0;
  can.mockClear();
});

describe("putting an upload on a job", () => {
  it("points the caller's own landed upload at the job, and only while no job holds it", async () => {
    expect(await attachJobDocument("d-9", "job-1")).toEqual({ ok: true });
    const [write] = writes();
    expect(write).toMatchObject({ table: "documents", op: "update", values: { sm8_job_uuid: "job-1" } });
    expect(write.filters).toEqual(
      expect.arrayContaining([
        ["eq", "org_id", "org-1"],
        ["eq", "id", "d-9"],
        /* two presses racing can't both claim the one row */
        ["is", "sm8_job_uuid", null],
      ])
    );
  });

  it("is the card's own tier", async () => {
    capWorkboard = false;
    expect(await attachJobDocument("d-9", "job-1")).toMatchObject({ ok: false });
    expect(can).toHaveBeenCalledWith("workboard");
    expect(writes()).toHaveLength(0);
  });

  it("re-resolves the job in this org's mirror rather than trusting the id", async () => {
    jobRow = null;
    expect(await attachJobDocument("d-9", "job-elsewhere")).toEqual({
      ok: false,
      error: "That job isn't in ServiceM8's copy any more.",
    });
    const jobRead = ops.find((o) => o.table === "sm8_jobs")!;
    expect(jobRead.filters).toEqual(expect.arrayContaining([["eq", "org_id", "org-1"], ["eq", "uuid", "job-elsewhere"]]));
    expect(writes().some((w) => w.op === "update")).toBe(false);
  });

  /* nothing reads a job document no job holds, so a file that lands for a
     job that isn't there would sit in the bucket unseen and billed */
  it("takes the caller's own landed file back out when the job isn't there", async () => {
    jobRow = null;
    await attachJobDocument("d-9", "job-elsewhere");
    expect(removed).toEqual([["org/org-1/job_document/d-9.pdf"]]);
    const [drop] = writes();
    expect(drop).toMatchObject({ table: "documents", op: "delete" });
    /* never a row a job already holds */
    expect(drop.filters).toEqual(expect.arrayContaining([["eq", "id", "d-9"], ["is", "sm8_job_uuid", null]]));
  });

  it("refuses someone else's upload", async () => {
    docRow = landed({ uploaded_by: "staff-2" });
    expect(await attachJobDocument("d-9", "job-1")).toEqual({ ok: false, error: "That isn't your upload." });
    expect(writes()).toHaveLength(0);
  });

  it("refuses a slot that never landed, and any other kind of file", async () => {
    docRow = landed({ uploaded_at: null });
    expect(await attachJobDocument("d-9", "job-1")).toMatchObject({ ok: false });
    docRow = landed({ kind: "receipt" });
    expect(await attachJobDocument("d-9", "job-1")).toMatchObject({ ok: false });
    expect(writes()).toHaveLength(0);
  });

  it("never moves a file off the job that already holds it", async () => {
    docRow = landed({ sm8_job_uuid: "job-2" });
    expect(await attachJobDocument("d-9", "job-1")).toEqual({
      ok: false,
      error: "That file is already on another job.",
    });
    expect(writes()).toHaveLength(0);
  });

  it("says so when the race was lost", async () => {
    updated = [];
    expect(await attachJobDocument("d-9", "job-1")).toMatchObject({ ok: false });
  });
});

describe("taking one of ours back off", () => {
  it("removes the bytes with the row", async () => {
    docRow = landed({ sm8_job_uuid: "job-1" });
    expect(await removeJobDocument("d-9")).toEqual({ ok: true });
    expect(removed).toEqual([["org/org-1/job_document/d-9.pdf"]]);
    expect(writes()[0]).toMatchObject({ table: "documents", op: "delete" });
    expect(writes()[0].filters).toEqual(expect.arrayContaining([["eq", "org_id", "org-1"], ["eq", "id", "d-9"]]));
  });

  /* ServiceM8's cached copies share the table; they are theirs, not ours */
  it("refuses anything that isn't a job document on a job", async () => {
    docRow = landed({ kind: "job_file", sm8_job_uuid: "job-1" });
    expect(await removeJobDocument("d-9")).toMatchObject({ ok: false });
    docRow = landed({ sm8_job_uuid: null });
    expect(await removeJobDocument("d-9")).toMatchObject({ ok: false });
    expect(removed).toEqual([]);
    expect(writes()).toHaveLength(0);
  });

  it("refuses a file whose bytes sit outside this org", async () => {
    docRow = landed({ sm8_job_uuid: "job-1", storage_ref: "org/org-2/job_document/d-9.pdf" });
    expect(await removeJobDocument("d-9")).toMatchObject({ ok: false });
    expect(removed).toEqual([]);
  });

  it("is the card's own tier", async () => {
    capWorkboard = false;
    docRow = landed({ sm8_job_uuid: "job-1" });
    expect(await removeJobDocument("d-9")).toMatchObject({ ok: false });
    expect(removed).toEqual([]);
  });
});
