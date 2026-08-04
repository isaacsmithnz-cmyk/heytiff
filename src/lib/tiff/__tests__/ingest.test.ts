/**
 * @jest-environment node
 *
 * One batch of ingestion. Two halves, tested separately on purpose:
 *
 *   THE DECISION (planBatch / progressPatch) is pure — "given this row and
 *   this allowance, what happens" and "given what happened, what does the row
 *   become". Those two answers are the ones that must never be wrong: a bad
 *   one either bills pages nobody asked for or silently skips pages nobody
 *   will notice are missing.
 *
 *   THE WALK (processBatch) is IO, so pdfjs, Claude, Voyage and storage are all
 *   mocked at the lib boundary. What is asserted is the ORDER of the writes:
 *   chunks land before the bookmark moves, and usage is counted only after
 *   both.
 */

const inserts: { table: string; rows: Record<string, unknown>[] }[] = [];
const updates: { table: string; patch: Record<string, unknown> }[] = [];
let docRow: Record<string, unknown> | null = null;
let insertFails = false;

const download = jest.fn(async () => ({
  data: { arrayBuffer: async () => new ArrayBuffer(8) },
  error: null,
}));

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = self;
      chain.eq = self;
      chain.maybeSingle = async () => ({ data: docRow });
      chain.insert = (payload: unknown) => {
        const rows = (Array.isArray(payload) ? payload : [payload]) as Record<string, unknown>[];
        inserts.push({ table, rows });
        return Promise.resolve({ error: insertFails ? { message: "nope" } : null });
      };
      chain.update = (patch: Record<string, unknown>) => {
        const sub: Record<string, unknown> = {};
        sub.eq = () => sub;
        sub.then = (res: (v: { error: null }) => unknown) => {
          updates.push({ table, patch });
          return Promise.resolve({ error: null }).then(res);
        };
        return sub;
      };
      return chain;
    },
    storage: { from: () => ({ download: () => download() }) },
  },
}));

type Quota = {
  plan: string;
  month: string;
  pagesUsed: number;
  questionsAsked: number;
  pagesAllowed: number;
  pagesRemaining: number;
  resetsOn: string;
};

const ROOMY_QUOTA: Quota = {
  plan: "standard",
  month: "2026-08-01",
  pagesUsed: 0,
  questionsAsked: 0,
  pagesAllowed: 2000,
  pagesRemaining: 2000,
  resetsOn: "2026-09-01",
};

const kbQuotaFor = jest.fn(async (): Promise<Quota> => ROOMY_QUOTA);
const addKbUsage = jest.fn(async () => {});
jest.mock("../quota", () => ({
  kbQuotaFor: (...a: unknown[]) => kbQuotaFor(...(a as [])),
  addKbUsage: (...a: unknown[]) => addKbUsage(...(a as [])),
}));

let pdfPages = 3;
let pageTexts: Record<number, string> = {};
const destroy = jest.fn(async () => {});
const openPdf = jest.fn(async () => ({
  numPages: pdfPages,
  pageText: async (n: number) => pageTexts[n] ?? `page ${n}: ${"content ".repeat(20)}`,
  destroy,
}));
jest.mock("../extract", () => ({
  ...jest.requireActual("../extract"),
  openPdf: (...a: unknown[]) => openPdf(...(a as [])),
}));

type Tagged = { ok: boolean; keywords?: string[][]; error?: string };
const tagChunks = jest.fn(
  async (chunks: string[]): Promise<Tagged> => ({ ok: true, keywords: chunks.map(() => ["P8"]) })
);
jest.mock("../keywords", () => ({ tagChunks: (c: string[]) => tagChunks(c) }));

type Embedded = { ok: boolean; vectors?: number[][] | null; reason?: string };
const embedTexts = jest.fn(async (): Promise<Embedded> => ({ ok: true, vectors: null }));
jest.mock("../embeddings", () => ({ embedTexts: () => embedTexts() }));

import { planBatch, processBatch, progressPatch, type DocState } from "../ingest";

const doc = (over: Partial<DocState> = {}): DocState => ({
  status: "processing",
  nextPage: 1,
  pageCount: null,
  chunkCount: 0,
  storageRef: "org/org-1/kb/doc-1.pdf",
  ...over,
});

const ROOMY = { pagesRemaining: 2000, resetsOn: "2026-09-01" };
const SPENT = { pagesRemaining: 0, resetsOn: "2026-09-01" };

const row = (over: Record<string, unknown> = {}) => ({
  status: "processing",
  next_page: 1,
  page_count: null,
  chunk_count: 0,
  scanned_pages: 0,
  storage_ref: "org/org-1/kb/doc-1.pdf",
  ...over,
});

const patchesTo = (table: string) => updates.filter((u) => u.table === table).map((u) => u.patch);

beforeEach(() => {
  inserts.length = 0;
  updates.length = 0;
  insertFails = false;
  pdfPages = 3;
  pageTexts = {};
  docRow = row();
  jest.clearAllMocks();
  kbQuotaFor.mockResolvedValue(ROOMY_QUOTA);
  tagChunks.mockImplementation(async (chunks: string[]) => ({
    ok: true,
    keywords: chunks.map(() => ["P8"]),
  }));
  embedTexts.mockResolvedValue({ ok: true, vectors: null });
});

describe("the decision", () => {
  it("processes from the bookmark, a batch at a time", () => {
    expect(planBatch(doc({ nextPage: 41 }), ROOMY)).toEqual({
      kind: "process",
      from: 41,
      allowance: 20,
    });
  });

  /* The park. Checked BEFORE any work, so the document stops with nothing
     half-done and the first of next month picks up exactly here. */
  it("parks at the quota rather than processing a partial batch", () => {
    expect(planBatch(doc({ nextPage: 41 }), SPENT)).toEqual({
      kind: "paused",
      resetsOn: "2026-09-01",
    });
  });

  it("resumes a paused document at its bookmark when there is room again", () => {
    expect(planBatch(doc({ status: "paused", nextPage: 41 }), ROOMY)).toEqual({
      kind: "process",
      from: 41,
      allowance: 20,
    });
  });

  it("gives a nearly-spent org the pages it does have", () => {
    expect(planBatch(doc(), { pagesRemaining: 7, resetsOn: "2026-09-01" })).toMatchObject({
      kind: "process",
      allowance: 7,
    });
  });

  it("calls a document past its last page done", () => {
    expect(planBatch(doc({ nextPage: 301, pageCount: 300 }), ROOMY)).toEqual({ kind: "done" });
    expect(planBatch(doc({ status: "ready" }), ROOMY)).toEqual({ kind: "done" });
  });

  /* An unconfirmed upload has no bytes yet, and a failed one needs a
     deliberate Retry — neither may be picked up by a loop that is just
     polling. */
  it("refuses a document that isn't ready to be walked", () => {
    for (const status of ["uploading", "failed"]) {
      expect(planBatch(doc({ status }), ROOMY)).toMatchObject({ kind: "refused" });
    }
  });

  it("refuses a document whose file never landed", () => {
    expect(planBatch(doc({ storageRef: null }), ROOMY)).toMatchObject({ kind: "refused" });
  });
});

describe("the row after a batch", () => {
  it("advances the bookmark past the page just read", () => {
    const patch = progressPatch(doc({ nextPage: 21, chunkCount: 30 }), 4, {
      lastPage: 40,
      numPages: 300,
      newChunks: 18,
      scanned: 2,
    });
    expect(patch).toMatchObject({
      status: "processing",
      next_page: 41,
      page_count: 300,
      chunk_count: 48,
      scanned_pages: 6, // accumulated, not replaced
      error: null,
    });
  });

  it("goes ready the moment the last page is read — no finalise step", () => {
    const patch = progressPatch(doc({ nextPage: 281 }), 0, {
      lastPage: 300,
      numPages: 300,
      newChunks: 12,
      scanned: 0,
    });
    expect(patch).toMatchObject({ status: "ready", next_page: 301 });
  });
});

describe("the walk", () => {
  it("chunks a batch, writes it, then moves the bookmark, then bills it", async () => {
    const progress = await processBatch("doc-1", "org-1");

    expect(inserts[0].table).toBe("kb_chunks");
    expect(inserts[0].rows[0]).toMatchObject({
      org_id: "org-1",
      document_id: "doc-1",
      chunk_index: 0,
      page_from: 1,
      keywords: ["P8"],
      embedding: null, // no Voyage key: keyword-only, backfilled later
    });
    expect(patchesTo("kb_documents")[0]).toMatchObject({ status: "ready", next_page: 4 });
    expect(addKbUsage).toHaveBeenCalledWith("org-1", { pages: 3 });
    expect(progress).toMatchObject({ status: "ready", pagesDone: 3, pageCount: 3 });
  });

  it("continues chunk numbering from where the last batch stopped", async () => {
    docRow = row({ next_page: 3, chunk_count: 17, page_count: 3 });
    await processBatch("doc-1", "org-1");
    expect(inserts[0].rows[0]).toMatchObject({ chunk_index: 17 });
  });

  it("stores the vector against the chunk it was made for", async () => {
    embedTexts.mockResolvedValue({ ok: true, vectors: [[0.5, 0.25]] });
    pdfPages = 1;
    await processBatch("doc-1", "org-1");
    expect(inserts[0].rows[0]).toMatchObject({ embedding: "[0.5,0.25]" });
  });

  it("counts a textless page as scanned instead of indexing it blank", async () => {
    pageTexts = { 2: "" };
    await processBatch("doc-1", "org-1");

    expect(patchesTo("kb_documents")[0]).toMatchObject({ scanned_pages: 1 });
    for (const r of inserts[0].rows) expect(r.page_from).not.toBe(2);
  });

  /* Both enhancements are allowed to fail without stopping ingestion: the
     chunk still matches on its own content, and a later run backfills. */
  it("ingests untagged when keyword tagging fails", async () => {
    tagChunks.mockResolvedValue({ ok: false, error: "too busy" });
    await processBatch("doc-1", "org-1");

    expect(inserts[0].rows[0]).toMatchObject({ keywords: [] });
    expect(patchesTo("kb_documents")[0]).toMatchObject({ status: "ready" });
  });

  it("ingests with null embeddings when Voyage fails", async () => {
    embedTexts.mockResolvedValue({ ok: false, reason: "refused" });
    await processBatch("doc-1", "org-1");

    expect(inserts[0].rows[0]).toMatchObject({ embedding: null });
    expect(patchesTo("kb_documents")[0]).toMatchObject({ status: "ready" });
  });

  it("parks at the quota without opening the file or billing anything", async () => {
    kbQuotaFor.mockResolvedValue({
      plan: "trial",
      month: "2026-08-01",
      pagesUsed: 200,
      questionsAsked: 0,
      pagesAllowed: 200,
      pagesRemaining: 0,
      resetsOn: "2026-09-01",
    });
    const progress = await processBatch("doc-1", "org-1");

    expect(progress).toMatchObject({ status: "paused", resetsOn: "2026-09-01" });
    expect(patchesTo("kb_documents")[0]).toMatchObject({ status: "paused" });
    expect(openPdf).not.toHaveBeenCalled();
    expect(addKbUsage).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it("resumes the parked document at its bookmark on the next call", async () => {
    docRow = row({ status: "paused", next_page: 3, page_count: 3, chunk_count: 9 });
    const progress = await processBatch("doc-1", "org-1");

    expect(inserts[0].rows[0]).toMatchObject({ chunk_index: 9, page_from: 3 });
    expect(addKbUsage).toHaveBeenCalledWith("org-1", { pages: 1 });
    expect(progress).toMatchObject({ status: "ready" });
  });

  /* The bookmark has NOT moved, so the retry re-reads the same pages. The
     other order would leave a gap nobody could ever find. */
  it("fails without advancing the bookmark when the chunks can't be stored", async () => {
    insertFails = true;
    const progress = await processBatch("doc-1", "org-1");

    expect(progress).toMatchObject({ status: "failed" });
    expect(patchesTo("kb_documents")[0]).toMatchObject({ status: "failed" });
    expect(patchesTo("kb_documents")[0]).not.toHaveProperty("next_page");
    expect(addKbUsage).not.toHaveBeenCalled();
  });

  it("fails with a reason when the file can't be downloaded", async () => {
    download.mockResolvedValueOnce({ data: null, error: { message: "gone" } } as never);
    const progress = await processBatch("doc-1", "org-1");

    expect(progress).toMatchObject({ status: "failed", error: "That file couldn't be read." });
    expect(patchesTo("kb_documents")[0]).toMatchObject({ status: "failed" });
  });

  it("fails with a reason when the PDF can't be opened", async () => {
    openPdf.mockRejectedValueOnce(new Error("InvalidPDFException"));
    expect(await processBatch("doc-1", "org-1")).toMatchObject({
      status: "failed",
      error: "That PDF couldn't be opened.",
    });
  });

  it("refuses a ref belonging to another org, before touching storage", async () => {
    docRow = row({ storage_ref: "org/org-2/kb/doc-1.pdf" });
    const progress = await processBatch("doc-1", "org-1");

    expect(progress).toMatchObject({ status: "failed" });
    expect(download).not.toHaveBeenCalled();
  });

  it("releases the parsed file even when the batch blows up", async () => {
    insertFails = true;
    await processBatch("doc-1", "org-1");
    expect(destroy).toHaveBeenCalled();
  });

  it("says so plainly when the document is gone", async () => {
    docRow = null;
    expect(await processBatch("doc-1", "org-1")).toMatchObject({
      status: "failed",
      error: "That document is gone.",
    });
    expect(inserts).toHaveLength(0);
  });
});
