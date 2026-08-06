/* The publish path — what a tick on "Worth teaching everyone" actually does.

   The mock mirrors the house recipe from the other action tests: a chainable
   query stub that records inserts/deletes, so assertions read the rows the
   database would have received. */

import { fieldNoteHeading, keywordsFromTitle, publishFieldNote } from "../field-notes";

const inserts: { table: string; row: Record<string, unknown> }[] = [];
const deletes: { table: string }[] = [];
let chunkInsertFails = false;

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        if (table === "kb_chunks" && chunkInsertFails) {
          inserts.push({ table, row });
          return Promise.resolve({ error: { message: "nope" } });
        }
        inserts.push({ table, row });
        return {
          select: () => ({
            maybeSingle: () => Promise.resolve({ data: { id: "doc-1" }, error: null }),
          }),
          // a bare await on the insert (no .select) resolves to no error
          then: (fn: (v: { error: null }) => unknown) => Promise.resolve(fn({ error: null })),
        };
      },
      delete: () => ({
        eq: () => ({
          eq: () => {
            deletes.push({ table });
            return Promise.resolve({ error: null });
          },
        }),
      }),
    }),
  },
}));

jest.mock("../embeddings", () => ({
  embedTexts: jest.fn(async () => ({ ok: true, vectors: [[0.1, 0.2]] })),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { embedTexts } = require("../embeddings") as { embedTexts: jest.Mock };

const INPUT = {
  orgId: "org-1",
  authorId: "s-1",
  authorName: "Luke Mercer",
  title: "Clearing an E6 without the manual",
  body: "Power the outdoor board separately before resetting — the manual reset alone doesn't clear it.",
  jobLabel: "Meridian Data · CRACs",
  dayLabel: "Wed 6 Aug",
  noteId: "n-1",
};

beforeEach(() => {
  inserts.length = 0;
  deletes.length = 0;
  chunkInsertFails = false;
  embedTexts.mockClear();
  embedTexts.mockResolvedValue({ ok: true, vectors: [[0.1, 0.2]] });
});

describe("publishFieldNote", () => {
  it("writes a ready NOTE document on the field shelf with the author on it", async () => {
    const res = await publishFieldNote(INPUT);
    expect(res.ok).toBe(true);
    const doc = inserts.find((i) => i.table === "kb_documents")!.row;
    expect(doc).toMatchObject({
      org_id: "org-1",
      category: "field",
      kind: "NOTE",
      status: "ready",
      title: INPUT.title,
      source: "Luke Mercer",
      uploaded_by: "s-1",
    });
  });

  it("one chunk, page 1/1, wearing the provenance heading", async () => {
    await publishFieldNote(INPUT);
    const chunk = inserts.find((i) => i.table === "kb_chunks")!.row;
    expect(chunk).toMatchObject({
      document_id: "doc-1",
      chunk_index: 0,
      page_from: 1,
      page_to: 1,
      content: INPUT.body,
      heading: "Learned on the job — Luke Mercer, Wed 6 Aug · at Meridian Data · CRACs",
    });
    expect(chunk.embedding).toBe(JSON.stringify([0.1, 0.2]));
  });

  it("an embedding outage degrades to a keyword-only chunk, never a refusal", async () => {
    embedTexts.mockResolvedValue({ ok: false, reason: "down" });
    const res = await publishFieldNote(INPUT);
    expect(res.ok).toBe(true);
    expect(inserts.find((i) => i.table === "kb_chunks")!.row.embedding).toBeNull();
  });

  it("a chunk failure takes the header row back out — no invisible documents", async () => {
    chunkInsertFails = true;
    const res = await publishFieldNote(INPUT);
    expect(res.ok).toBe(false);
    expect(deletes).toEqual([{ table: "kb_documents" }]);
  });

  it("refuses emptiness rather than publishing a blank card", async () => {
    expect((await publishFieldNote({ ...INPUT, body: "  " })).ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });
});

describe("the provenance line", () => {
  it("names the person, the day and the job", () => {
    expect(fieldNoteHeading(INPUT)).toBe(
      "Learned on the job — Luke Mercer, Wed 6 Aug · at Meridian Data · CRACs"
    );
  });

  it("drops the job cleanly when there wasn't one", () => {
    expect(fieldNoteHeading({ ...INPUT, jobLabel: null })).toBe(
      "Learned on the job — Luke Mercer, Wed 6 Aug"
    );
  });
});

describe("keywordsFromTitle", () => {
  it("keeps fault codes however short — E6 is the whole search", () => {
    expect(keywordsFromTitle("Clearing an E6 without the manual")).toEqual([
      "clearing",
      "e6",
      "without",
      "the",
      "manual",
    ]);
  });

  it("model numbers with digits survive too", () => {
    expect(keywordsFromTitle("PUZ-ZM250 P8 trip")).toContain("p8");
  });

  it("dedupes and caps at ten", () => {
    const kw = keywordsFromTitle("one two three four five six seven eight nine ten eleven one two");
    expect(kw).toHaveLength(10);
    expect(new Set(kw).size).toBe(10);
  });
});
