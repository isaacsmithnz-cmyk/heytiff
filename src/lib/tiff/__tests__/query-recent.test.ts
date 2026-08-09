/* The landing's "Recently added" strip — the read behind it.

   What matters here isn't the SQL, it's the two promises the strip makes by
   existing: every row on it can actually be asked about, and every row says
   something true about what it is. A half-read manual on that list would
   invite a question Tiff can't answer yet, and a row with no name is a button
   with nothing written on it. */

const filters: { col: string; value: unknown }[] = [];
const order: { col: string; opts: unknown }[] = [];
let limited: number | null = null;
let rows: Record<string, unknown>[] = [];

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = (col: string, value: unknown) => {
        filters.push({ col, value });
        return chain;
      };
      chain.not = (col: string, op: string, value: unknown) => {
        filters.push({ col: `${col} ${op}`, value });
        return chain;
      };
      chain.order = (col: string, opts: unknown) => {
        order.push({ col, opts });
        return chain;
      };
      chain.limit = async (n: number) => {
        limited = n;
        return { data: rows };
      };
      return chain;
    },
  },
}));

import { kbRecentDocs } from "../query";

const doc = (over: Record<string, unknown> = {}) => ({
  id: "d-1",
  title: "Daikin VRV Diagnosis Manual",
  category: "faults",
  page_count: 385,
  ...over,
});

beforeEach(() => {
  filters.length = 0;
  order.length = 0;
  limited = null;
  rows = [];
});

describe("the recently added documents", () => {
  it("asks the caller's own org for READY documents, newest landing first", async () => {
    rows = [doc()];
    await kbRecentDocs("org-1", 4);

    expect(filters).toEqual(
      expect.arrayContaining([
        { col: "org_id", value: "org-1" },
        // a manual still being read cannot answer anything yet
        { col: "status", value: "ready" },
        // a slot handed out and abandoned is not a document
        { col: "uploaded_at is", value: null },
      ])
    );
    // "recently added" is when it LANDED, not when the row was first created
    expect(order).toEqual([{ col: "uploaded_at", opts: { ascending: false } }]);
    expect(limited).toBe(4);
  });

  it("carries the name, the category and the size", async () => {
    rows = [doc()];
    expect(await kbRecentDocs("org-1")).toEqual([
      { id: "d-1", title: "Daikin VRV Diagnosis Manual", category: "faults", pageCount: 385 },
    ]);
  });

  /* A row with no name is a button with nothing written on it, and a category
     the app doesn't have has no colour and no label to render. */
  it("drops a row it could not put on screen honestly", async () => {
    rows = [
      doc({ id: "d-1", title: "   " }),
      doc({ id: "d-2", category: "gremlins" }),
      doc({ id: "d-3", title: "Install guide", category: "install" }),
    ];

    const out = await kbRecentDocs("org-1");
    expect(out.map((d) => d.id)).toEqual(["d-3"]);
  });

  it("reads a missing page count as unknown rather than zero", async () => {
    rows = [doc({ page_count: null })];
    expect((await kbRecentDocs("org-1"))[0].pageCount).toBeNull();
  });

  it("trims a title that arrived with whitespace round it", async () => {
    rows = [doc({ title: "  Install guide  " })];
    expect((await kbRecentDocs("org-1"))[0].title).toBe("Install guide");
  });

  it("is an empty strip, not a failure, when the library is empty", async () => {
    rows = [];
    expect(await kbRecentDocs("org-1")).toEqual([]);
  });
});
