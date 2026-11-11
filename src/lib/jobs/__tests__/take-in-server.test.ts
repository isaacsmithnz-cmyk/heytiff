/** @jest-environment node */
/* Every PDF on a job taken in once (take-in-server.ts): sorted by its own
   words, drawings and specs into Plans, the rest kept with why, a file seen
   before left alone, the same bytes again pointing at the first, and a
   press of Add plans standing. The database, the storage and the PDF reader
   are fakes; the sort is the real one. */

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const bytesOf: Record<string, string> = {};
const added: { picks: unknown[]; kind: string }[] = [];

jest.mock("next/headers", () => ({ headers: async () => new Headers({ host: "app.test" }) }));
jest.mock("next/server", () => ({ after: () => {} }));
jest.mock("@/lib/studio/pdf-request", () => ({ signPlanReadTicket: () => "ticket" }));

jest.mock("@/lib/supabase-server", () => {
  const query = (table: string) => {
    const filters: [string, string, unknown][] = [];
    let insert: Row | null = null;
    let update: Row | null = null;
    const rows = () =>
      (tables[table] ?? []).filter((r) =>
        filters.every(([op, col, val]) => (op === "eq" ? r[col] === val : op === "neq" ? r[col] !== val : true)),
      );
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push(["eq", c, v]), q),
      neq: (c: string, v: unknown) => (filters.push(["neq", c, v]), q),
      limit: () => q,
      order: () => q,
      insert: (r: Row) => ((insert = r), q),
      update: (r: Row) => ((update = r), q),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
        if (insert) (tables[table] ??= []).push(insert);
        if (update) for (const r of rows()) Object.assign(r, update);
        return Promise.resolve({ data: rows(), error: null }).then(res, rej);
      },
    };
    return q;
  };
  return {
    supabaseAdmin: {
      from: query,
      storage: { from: () => ({ download: async (ref: string) => ({ data: new Blob([bytesOf[ref] ?? ""]), error: null }) }) },
    },
  };
});

/* each file's pages, by its bytes */
const PAGES: Record<string, { w: number; h: number; text: string }[]> = {
  "set-g": Array.from({ length: 25 }, () => ({ w: 2384, h: 1684, text: "GROUND FLOOR SCALE 1:50 @ A1" })),
  spec: [{ w: 595, h: 842, text: "Tender project specification, 7 Cutler Road. Mechanical ventilation and air conditioning" }],
  invoice: [{ w: 595, h: 842, text: "Diamond Air Solutions Tax Invoice 2845A, JT Construct, 7 Cutler Rd, progress claim" }],
  cert: [{ w: 595, h: 842, text: "Certificate of currency, public liability" }],
};
jest.mock("@/lib/tiff/extract", () => ({
  openPdf: async (bytes: Uint8Array) => {
    const pages = PAGES[new TextDecoder().decode(bytes)] ?? [];
    return {
      numPages: pages.length,
      pageText: async (n: number) => pages[n - 1]!.text,
      pageSize: async (n: number) => ({ w: pages[n - 1]!.w, h: pages[n - 1]!.h }),
      title: async () => null,
      destroy: async () => {},
    };
  },
}));

jest.mock("../plans-server", () => ({
  fileFor: async (_o: string, _j: string, pick: { documentId: string }) => ({ name: `${pick.documentId}.pdf`, ref: pick.documentId, mime: "application/pdf" }),
  kindOf: () => "pdf",
  addJobPlans: async (_o: string, jobUuid: string, picks: { documentId: string }[], _s: string | null, kind: string) => {
    added.push({ picks, kind });
    const id = `jplan-${picks[0]!.documentId}`;
    (tables.job_plans ??= []).push({ id, org_id: "org-1", job_uuid: jobUuid, document_id: picks[0]!.documentId, state: "reading" });
    return { ok: true, planIds: [id], already: 0 };
  },
}));

import { takeInFiles } from "../take-in-server";

const reads = () => (tables.job_file_reads ?? []).map((r) => [r.document_id, r.sort, r.why, r.plan_id]);

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  tables.organizations = [{ id: "org-1", trading_name: "Diamond Air Solutions", name: "Diamond Air Solutions Pty Ltd" }];
  tables.sm8_jobs = [{ org_id: "org-1", uuid: "job-2845", job_address: "7 Cutler Rd\nClontarf NSW 2093" }];
  added.length = 0;
  Object.assign(bytesOf, { "d-set": "set-g", "d-spec": "spec", "d-inv": "invoice", "d-cert": "cert", "d-set-again": "set-g" });
});

describe("taking a job's PDFs in", () => {
  it("puts drawings and a spec into Plans, and keeps the rest with why", async () => {
    const out = await takeInFiles("org-1", "job-2845", ["d-set", "d-spec", "d-inv", "d-cert"].map((documentId) => ({ documentId })), "staff-1");
    expect(out.planIds).toEqual(["jplan-d-set", "jplan-d-spec"]);
    expect(added.map((a) => a.kind)).toEqual(["drawings", "spec"]);
    expect(reads()).toEqual([
      ["d-set", "drawings", "25 sheets at A1", "jplan-d-set"],
      ["d-spec", "spec", "A specification, 1 page, that names air conditioning, ventilation and mechanical services", "jplan-d-spec"],
      ["d-inv", "ours", "Our own paperwork", null],
      ["d-cert", "other", "Not drawings, a specification or a scope", null],
    ]);
  });

  it("never reads a file twice", async () => {
    await takeInFiles("org-1", "job-2845", [{ documentId: "d-set" }], null);
    const again = await takeInFiles("org-1", "job-2845", [{ documentId: "d-set" }], null);
    expect(again.planIds).toEqual([]);
    expect(reads()).toHaveLength(1);
  });

  it("points the same bytes by another door at the first", async () => {
    await takeInFiles("org-1", "job-2845", [{ documentId: "d-set" }], null);
    const out = await takeInFiles("org-1", "job-2845", [{ documentId: "d-set-again" }], null);
    expect(out.planIds).toEqual([]);
    expect(reads()[1]).toEqual(["d-set-again", "same", "The same file as d-set.pdf, read already", "jplan-d-set"]);
  });

  it("lets a press of Add plans stand, whatever the words say", async () => {
    tables.job_plans = [{ id: "jplan-hand", org_id: "org-1", job_uuid: "job-2845", document_id: "d-cert", state: "reading" }];
    const out = await takeInFiles("org-1", "job-2845", [{ documentId: "d-cert" }], null);
    expect(out.planIds).toEqual([]);
    expect(added).toHaveLength(0);
    expect(reads()).toEqual([["d-cert", "drawings", "Put in Plans by hand", "jplan-hand"]]);
  });
});
