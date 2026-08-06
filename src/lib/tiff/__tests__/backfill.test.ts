/**
 * @jest-environment node
 *
 * The backfill: the second half of "a later re-run fills these in", which for
 * a while did not exist.
 *
 * What these pin is the pair of things a person pressing the button is
 * trusting: that only READY documents are touched (a document still being read
 * gets its vectors from its own next batch, and two writers on the same rows
 * spend the same Voyage requests twice), and that a rate-limited account STOPS
 * and says so rather than asking sixty more times and reporting nothing.
 *
 * Supabase is mocked at the client boundary and Voyage at the lib boundary, so
 * what is asserted is the QUERY (ready-only, null-only, stable order) and the
 * WRITE (the same text form ingestion inserts).
 */

type Query = {
  table: string;
  op: "select" | "update";
  head: boolean;
  eqs: Record<string, unknown>;
  ins: Record<string, unknown>;
  nulls: string[];
  orders: string[];
  limit: number | null;
  patch: Record<string, unknown> | null;
};

const queries: Query[] = [];
let readyDocIds: string[] = ["doc-1"];
let chunkRows: { id: string; content: string }[] = [];
let backlog: number | null = null;
let updateError: { message: string } | null = null;
let failUpdateAt: number | null = null;

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const q: Query = {
        table,
        op: "select",
        head: false,
        eqs: {},
        ins: {},
        nulls: [],
        orders: [],
        limit: null,
        patch: null,
      };
      const chain: Record<string, unknown> = {};
      const self = () => chain;

      chain.select = (_cols: string, opts?: { head?: boolean }) => {
        q.head = Boolean(opts?.head);
        return chain;
      };
      chain.eq = (col: string, value: unknown) => {
        q.eqs[col] = value;
        return chain;
      };
      chain.in = (col: string, values: unknown) => {
        q.ins[col] = values;
        return chain;
      };
      chain.is = (col: string) => {
        q.nulls.push(col);
        return chain;
      };
      chain.order = (col: string) => {
        q.orders.push(col);
        return chain;
      };
      chain.limit = (n: number) => {
        q.limit = n;
        return chain;
      };
      chain.update = (patch: Record<string, unknown>) => {
        q.op = "update";
        q.patch = patch;
        return chain;
      };
      chain.maybeSingle = self;

      chain.then = (resolve: (v: unknown) => unknown) => {
        queries.push(q);

        if (q.op === "update") {
          const at = queries.filter((x) => x.op === "update").length;
          const error = failUpdateAt === at ? { message: "write conflict" } : updateError;
          return Promise.resolve({ error }).then(resolve);
        }
        if (q.table === "kb_documents") {
          return Promise.resolve({ data: readyDocIds.map((id) => ({ id })) }).then(resolve);
        }

        const count = backlog ?? chunkRows.length;
        const rows = chunkRows.slice(0, q.limit ?? chunkRows.length);
        return Promise.resolve({ data: q.head ? null : rows, count }).then(resolve);
      };

      return chain;
    },
  },
}));

type Embedded = { ok: boolean; vectors?: number[][] | null; reason?: string; detail?: string };
const embedTexts = jest.fn(async (texts: string[]): Promise<Embedded> => ({
  ok: true,
  vectors: texts.map((_t, i) => [i / 10, (i + 1) / 10]),
}));
let configured = true;
jest.mock("../embeddings", () => ({
  embedTexts: (texts: string[]) => embedTexts(texts),
  isSemanticConfigured: () => configured,
}));

import {
  BACKFILL_BATCH,
  backfillBatch,
  countUnembedded,
  remainingAfter,
  stopForEmbedFailure,
} from "../backfill";

const chunk = (n: number) => ({ id: `c-${n}`, content: `passage ${n}` });

const selectsOn = (table: string) => queries.filter((q) => q.table === table && q.op === "select");
const updatesOn = (table: string) => queries.filter((q) => q.table === table && q.op === "update");

beforeEach(() => {
  queries.length = 0;
  readyDocIds = ["doc-1", "doc-2"];
  chunkRows = [];
  backlog = null;
  updateError = null;
  failUpdateAt = null;
  configured = true;
  jest.clearAllMocks();
  embedTexts.mockImplementation(async (texts: string[]) => ({
    ok: true,
    vectors: texts.map((_t, i) => [i / 10, (i + 1) / 10]),
  }));
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

/* ── the arithmetic ──────────────────────────────────────────────────────── */

describe("the decisions", () => {
  it("counts down, and never past zero", () => {
    expect(remainingAfter(106, 64)).toBe(42);
    expect(remainingAfter(106, 106)).toBe(0);
    // an ingest run finishing alongside makes the total stale, not negative
    expect(remainingAfter(10, 64)).toBe(0);
  });

  /* Only the rate limit is worth saying out loud: it is the one a person can
     do something about, and the one that comes right on its own. */
  it("tells the rate limit apart from everything else that can go wrong", () => {
    expect(stopForEmbedFailure("rate-limited")).toBe("rate-limited");
    expect(stopForEmbedFailure("unauthorised")).toBe("failed");
    expect(stopForEmbedFailure("unreachable")).toBe("failed");
    expect(stopForEmbedFailure("bad-response")).toBe("failed");
  });
});

/* ── what is left ────────────────────────────────────────────────────────── */

describe("countUnembedded", () => {
  it("counts the null embeddings inside this org's ready documents", async () => {
    backlog = 106;
    expect(await countUnembedded("org-1")).toBe(106);

    const docs = selectsOn("kb_documents")[0];
    expect(docs.eqs).toMatchObject({ org_id: "org-1", status: "ready" });

    const chunks = selectsOn("kb_chunks")[0];
    expect(chunks.head).toBe(true);
    expect(chunks.eqs).toMatchObject({ org_id: "org-1" });
    expect(chunks.ins).toMatchObject({ document_id: ["doc-1", "doc-2"] });
    expect(chunks.nulls).toEqual(["embedding"]);
  });

  /* A document still being read gets its vectors from its own next batch, at
     the same time as its chunks — counting those would promise work the button
     must not do. */
  it("is zero when nothing is ready yet, without reading a single chunk", async () => {
    readyDocIds = [];
    expect(await countUnembedded("org-1")).toBe(0);
    expect(selectsOn("kb_chunks")).toHaveLength(0);
  });

  it("reads a missing count as zero rather than as an error", async () => {
    backlog = null;
    chunkRows = [];
    expect(await countUnembedded("org-1")).toBe(0);
  });
});

/* ── one batch ───────────────────────────────────────────────────────────── */

describe("backfillBatch", () => {
  it("embeds what it read and writes a vector onto every row", async () => {
    chunkRows = [chunk(1), chunk(2), chunk(3)];
    backlog = 106;

    const result = await backfillBatch("org-1");

    expect(embedTexts).toHaveBeenCalledWith(["passage 1", "passage 2", "passage 3"]);
    expect(result).toEqual({ done: 3, remaining: 103 });
    expect(updatesOn("kb_chunks").map((u) => u.eqs.id)).toEqual(["c-1", "c-2", "c-3"]);
  });

  /* The same text form ingest.ts inserts — pgvector parses it, and the column
     is vector(1024) either way. A different shape here would store the whole
     backfill as unusable rows nobody would think to check. */
  it("stores the vector exactly as ingestion does", async () => {
    chunkRows = [chunk(1)];
    embedTexts.mockResolvedValue({ ok: true, vectors: [[0.5, 0.25]] });

    await backfillBatch("org-1");

    expect(updatesOn("kb_chunks")[0].patch).toEqual({ embedding: "[0.5,0.25]" });
  });

  it("asks for one batch at a time, oldest document first", async () => {
    chunkRows = Array.from({ length: 200 }, (_, i) => chunk(i));
    backlog = 200;

    const result = await backfillBatch("org-1");

    const read = selectsOn("kb_chunks")[0];
    expect(read.limit).toBe(BACKFILL_BATCH);
    // stable, so consecutive calls walk the library instead of re-rolling it
    expect(read.orders).toEqual(["document_id", "chunk_index"]);
    expect(read.nulls).toEqual(["embedding"]);
    expect(result).toEqual({ done: BACKFILL_BATCH, remaining: 200 - BACKFILL_BATCH });
  });

  it("takes a smaller batch when asked for one", async () => {
    chunkRows = Array.from({ length: 20 }, (_, i) => chunk(i));
    await backfillBatch("org-1", 5);
    expect(selectsOn("kb_chunks")[0].limit).toBe(5);
  });

  it("only ever reads chunks belonging to ready documents in this org", async () => {
    chunkRows = [chunk(1)];
    await backfillBatch("org-1");

    expect(selectsOn("kb_documents")[0].eqs).toMatchObject({ org_id: "org-1", status: "ready" });
    expect(selectsOn("kb_chunks")[0].ins).toMatchObject({ document_id: ["doc-1", "doc-2"] });
    // and the write is org-scoped too, not by id alone
    expect(updatesOn("kb_chunks")[0].eqs).toMatchObject({ org_id: "org-1", id: "c-1" });
  });

  it("does nothing, quietly, when every passage already has a vector", async () => {
    chunkRows = [];

    expect(await backfillBatch("org-1")).toEqual({ done: 0, remaining: 0 });
    expect(embedTexts).not.toHaveBeenCalled();
    expect(updatesOn("kb_chunks")).toHaveLength(0);
  });

  it("does nothing when the library has no finished document at all", async () => {
    readyDocIds = [];

    expect(await backfillBatch("org-1")).toEqual({ done: 0, remaining: 0 });
    expect(selectsOn("kb_chunks")).toHaveLength(0);
    expect(embedTexts).not.toHaveBeenCalled();
  });

  /* THE WHOLE POINT. A capped account answers 429 to every request in the
     minute; the run stops on the first one, keeps the count, and hands back
     the reason for the screen to say in English. */
  it("stops on the rate limit rather than thrashing, and says which limit", async () => {
    chunkRows = [chunk(1), chunk(2)];
    backlog = 106;
    embedTexts.mockResolvedValue({ ok: false, reason: "rate-limited", detail: "429 3 RPM" });

    const result = await backfillBatch("org-1");

    expect(result).toEqual({ done: 0, remaining: 106, stopped: "rate-limited" });
    expect(updatesOn("kb_chunks")).toHaveLength(0);
    // and it is in the log, with the vendor's own words, for the next person
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("rate-limited"));
  });

  it("calls every other Voyage failure a plain failure", async () => {
    chunkRows = [chunk(1)];
    backlog = 12;
    embedTexts.mockResolvedValue({ ok: false, reason: "unauthorised", detail: "401" });

    expect(await backfillBatch("org-1")).toEqual({ done: 0, remaining: 12, stopped: "failed" });
  });

  it("refuses to run at all without a key, and says so instead of doing nothing", async () => {
    configured = false;
    backlog = 106;
    chunkRows = [chunk(1)];

    expect(await backfillBatch("org-1")).toEqual({
      done: 0,
      remaining: 106,
      stopped: "unconfigured",
    });
    expect(embedTexts).not.toHaveBeenCalled();
    expect(updatesOn("kb_chunks")).toHaveLength(0);
  });

  /* The rows already written keep their vectors; the rest are still null, and
     the next batch reads them again — there is nothing to roll back. */
  it("keeps what it wrote when a write fails partway through", async () => {
    chunkRows = [chunk(1), chunk(2), chunk(3), chunk(4)];
    backlog = 10;
    failUpdateAt = 3;

    const result = await backfillBatch("org-1");

    expect(result).toEqual({ done: 2, remaining: 8, stopped: "failed" });
    expect(updatesOn("kb_chunks")).toHaveLength(3); // the third is the one that failed
  });

  it("reports the whole backlog, not just the rows it read", async () => {
    chunkRows = Array.from({ length: 64 }, (_, i) => chunk(i));
    backlog = 285;

    expect(await backfillBatch("org-1")).toEqual({ done: 64, remaining: 221 });
  });

  // the key went away between the check and the call — the same answer, not a
  // run that appears to have done nothing for no stated reason
  it("treats null vectors as the unconfigured answer", async () => {
    chunkRows = [chunk(1)];
    backlog = 4;
    embedTexts.mockResolvedValue({ ok: true, vectors: null });

    expect(await backfillBatch("org-1")).toEqual({
      done: 0,
      remaining: 4,
      stopped: "unconfigured",
    });
  });
});
