/**
 * @jest-environment node
 *
 * Searching the library.
 *
 * The two legs are mocked at the RPC boundary — what is under test is what
 * happens BETWEEN them and the answer: that both legs are asked with the org
 * on them, that the vector leg is skipped rather than faked when there is no
 * key, that the merged order survives hydration, and that zero hits is a real
 * outcome rather than an exception.
 */

const rpc = jest.fn<Promise<{ data: unknown }>, [fn: string, args: Record<string, unknown>]>(
  async () => ({ data: [] })
);
const tables: Record<string, Record<string, unknown>[]> = {};
const reads: { table: string; ids: unknown }[] = [];

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = self;
      chain.eq = self;
      chain.in = async (_col: string, ids: unknown) => {
        reads.push({ table, ids });
        return { data: tables[table] ?? [] };
      };
      return chain;
    },
    rpc: (fn: string, args: Record<string, unknown>) => rpc(fn, args),
  },
}));

let semantic = false;
const embedTexts = jest.fn(async () => ({ ok: true as const, vectors: [[0.5, 0.25]] }));
jest.mock("../embeddings", () => ({
  isSemanticConfigured: () => semantic,
  embedTexts: (...a: unknown[]) => embedTexts(...(a as [])),
}));

const prepareQuery = jest.fn(async () => ({ terms: ["P8", "thermistor"], ftsQuery: "P8 OR thermistor" }));
jest.mock("../query-prep", () => ({ prepareQuery: (...a: unknown[]) => prepareQuery(...(a as [])) }));

const addKbUsage = jest.fn(async () => {});
jest.mock("../quota", () => ({ addKbUsage: (...a: unknown[]) => addKbUsage(...(a as [])) }));

import { EXCERPT_CHARS, LEG_LIMIT, recordQuestion, retrieveForQuestion } from "../retrieve";

const chunkRow = (id: string, documentId: string, content = "the page text") => ({
  id,
  document_id: documentId,
  content,
  page_from: 41,
  page_to: 42,
  heading: "Fault codes",
});

const docRow = (id: string, title: string, category: string) => ({ id, title, category });

const legRow = (id: string, documentId: string) => ({ id, document_id: documentId });

const call = (fn: string) => rpc.mock.calls.find(([name]) => name === fn)?.[1];

beforeEach(() => {
  jest.clearAllMocks();
  reads.length = 0;
  semantic = false;
  delete tables.kb_chunks;
  delete tables.kb_documents;
  // clearAllMocks forgets the CALLS, not the implementations — a per-test
  // mockResolvedValue would otherwise leak into every test after it
  rpc.mockResolvedValue({ data: [] });
  embedTexts.mockResolvedValue({ ok: true, vectors: [[0.5, 0.25]] });
  addKbUsage.mockResolvedValue(undefined);
});

describe("asking the two legs", () => {
  it("runs the keyword leg with the prepared query, the org, and no category filter", async () => {
    await retrieveForQuestion("org-1", "why P8?");

    expect(call("kb_fts")).toEqual({
      p_org: "org-1",
      p_query: "P8 OR thermistor",
      // every shelf is asked, because the trace's job is to say which answered
      p_cats: null,
      p_k: LEG_LIMIT,
    });
  });

  /* Without VOYAGE_API_KEY there are no stored vectors either — the leg is
     skipped rather than run against a table of nulls. */
  it("skips the vector leg entirely when semantic search isn't configured", async () => {
    await retrieveForQuestion("org-1", "why P8?");

    expect(embedTexts).not.toHaveBeenCalled();
    expect(call("kb_vec")).toBeUndefined();
  });

  it("embeds the question as a QUERY and hands pgvector its own text form", async () => {
    semantic = true;
    await retrieveForQuestion("org-1", "why P8?");

    expect(embedTexts).toHaveBeenCalledWith(["why P8?"], "query");
    expect(call("kb_vec")).toMatchObject({ p_org: "org-1", p_qvec: "[0.5,0.25]", p_k: LEG_LIMIT });
  });

  it("carries on with the keyword leg alone when embedding fails", async () => {
    semantic = true;
    embedTexts.mockResolvedValue({ ok: false, reason: "nope" } as never);
    rpc.mockImplementation(async (fn) => ({ data: fn === "kb_fts" ? [legRow("c-1", "d-1")] : [] }));
    tables.kb_chunks = [chunkRow("c-1", "d-1")];
    tables.kb_documents = [docRow("d-1", "Fault book", "faults")];

    const found = await retrieveForQuestion("org-1", "why P8?");

    expect(call("kb_vec")).toBeUndefined();
    expect(found.chunks).toHaveLength(1);
  });
});

describe("what comes back", () => {
  beforeEach(() => {
    semantic = true;
    rpc.mockImplementation(async (fn) => ({
      data:
        fn === "kb_fts"
          ? [legRow("c-1", "d-1"), legRow("c-2", "d-2")]
          : [legRow("c-2", "d-2"), legRow("c-3", "d-3")],
    }));
    tables.kb_chunks = [
      chunkRow("c-1", "d-1", "P8 is a piping temperature fault."),
      chunkRow("c-2", "d-2", "Install the liquid line thermistor."),
      chunkRow("c-3", "d-3", "How we log a warranty claim."),
    ];
    tables.kb_documents = [
      docRow("d-1", "Fault book", "faults"),
      docRow("d-2", "Install manual", "install"),
      docRow("d-3", "Warranty SOP", "sops"),
    ];
  });

  it("hydrates in fused order, not in the order the rows came back", async () => {
    const found = await retrieveForQuestion("org-1", "why P8?");
    // c-2 is in both legs, so fusion puts it first
    expect(found.chunks.map((c) => c.id)).toEqual(["c-2", "c-1", "c-3"]);
  });

  it("reads chunks and documents in one round trip each", async () => {
    await retrieveForQuestion("org-1", "why P8?");
    expect(reads.map((r) => r.table).sort()).toEqual(["kb_chunks", "kb_documents"]);
    expect(reads.find((r) => r.table === "kb_documents")?.ids).toEqual(["d-2", "d-1", "d-3"]);
  });

  it("carries the document's title and shelf onto every chunk", async () => {
    const [first] = (await retrieveForQuestion("org-1", "why P8?")).chunks;
    expect(first).toMatchObject({ title: "Install manual", category: "install", pageFrom: 41, pageTo: 42 });
  });

  it("numbers the sources in retrieval order and excerpts the page", async () => {
    const { sources } = await retrieveForQuestion("org-1", "why P8?");
    expect(sources.map((s) => s.n)).toEqual([1, 2, 3]);
    expect(sources[0]).toMatchObject({
      chunkId: "c-2",
      docId: "d-2",
      title: "Install manual",
      category: "install",
      excerpt: "Install the liquid line thermistor.",
    });
  });

  it("caps an excerpt to a screen of text", async () => {
    tables.kb_chunks = [chunkRow("c-1", "d-1", "x".repeat(5_000))];
    rpc.mockImplementation(async (fn) => ({ data: fn === "kb_fts" ? [legRow("c-1", "d-1")] : [] }));

    const { sources } = await retrieveForQuestion("org-1", "why P8?");
    expect(sources[0].excerpt).toHaveLength(EXCERPT_CHARS);
  });

  it("traces every shelf that answered, and the terms it searched with", async () => {
    const { trace } = await retrieveForQuestion("org-1", "why P8?");
    expect(trace.terms).toEqual(["P8", "thermistor"]);
    expect(trace.categories.install).toEqual({ hits: 1, topDoc: "Install manual" });
    expect(trace.categories.faults).toEqual({ hits: 1, topDoc: "Fault book" });
    expect(trace.categories.specs).toEqual({ hits: 0, topDoc: null });
    expect(trace.winners).toEqual(["install", "faults", "sops"]);
  });

  /* A citation to a chunk whose row has gone is a citation to nothing. */
  it("drops a chunk whose row or document vanished between search and read", async () => {
    tables.kb_chunks = [chunkRow("c-1", "d-1"), chunkRow("c-2", "d-2")];
    tables.kb_documents = [docRow("d-1", "Fault book", "faults")];

    const found = await retrieveForQuestion("org-1", "why P8?");
    expect(found.chunks.map((c) => c.id)).toEqual(["c-1"]);
  });
});

describe("finding nothing", () => {
  it("is an ordinary answer: no chunks, no sources, a zeroed trace with the terms", async () => {
    const found = await retrieveForQuestion("org-1", "why P8?");

    expect(found.chunks).toEqual([]);
    expect(found.sources).toEqual([]);
    expect(found.trace.winners).toEqual([]);
    expect(found.trace.terms).toEqual(["P8", "thermistor"]);
    expect(found.trace.categories.sops).toEqual({ hits: 0, topDoc: null });
  });

  it("doesn't go looking for chunks it doesn't have", async () => {
    await retrieveForQuestion("org-1", "why P8?");
    expect(reads).toHaveLength(0);
  });
});

describe("counting the question", () => {
  it("adds one to this month's questions, and nothing else", async () => {
    await recordQuestion("org-1");
    expect(addKbUsage).toHaveBeenCalledWith("org-1", { questions: 1 });
  });

  /* The answer is the product; the count is bookkeeping. */
  it("swallows a failed count rather than failing the question", async () => {
    addKbUsage.mockRejectedValue(new Error("db down") as never);
    await expect(recordQuestion("org-1")).resolves.toBeUndefined();
  });
});
