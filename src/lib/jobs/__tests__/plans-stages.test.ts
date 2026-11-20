/** @jest-environment node */
/* A plan set read in stages (plans-server.ts readPlan), each saved before
   the next: the pages drawn small in Node and the floors found among them;
   the floors drawn in full in Node; then the read. A run past its time at
   the end of a stage hands the rest to a fresh run of the read route, and
   the next run picks up where it stopped. 3570, 20 November 2026: Luke's
   27-sheet A1 set, which the headless browser on Vercel never once drew.
   The database, the storage, Node's drawing and the readers are fakes. */

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const uploads: string[] = [];
let clock = 0;

jest.mock("server-only", () => ({}));
jest.mock("@/lib/supabase-server", () => {
  const query = (table: string) => {
    const filters: [string, unknown][] = [];
    let update: Row | null = null;
    const rows = () => (tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push([c, v]), q),
      or: () => q,
      in: () => q,
      not: () => q,
      order: () => q,
      update: (r: Row) => ((update = r), q),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
        const hit = rows();
        if (update) for (const r of hit) Object.assign(r, update);
        return Promise.resolve({ data: hit, error: null }).then(res, rej);
      },
    };
    return q;
  };
  return {
    supabaseAdmin: {
      from: query,
      storage: {
        from: () => ({
          download: async () => ({ data: new Blob([new Uint8Array([37, 80, 68, 70])]), error: null }),
          upload: async (ref: string) => (uploads.push(ref), { error: null }),
          createSignedUrl: async (ref: string) => ({ data: { signedUrl: `https://store.test/${ref}` }, error: null }),
          createSignedUrls: async () => ({ data: [], error: null }),
        }),
      },
    },
  };
});
jest.mock("@/lib/studio/pdf-render", () => ({
  printBase: (o: string) => o,
  launchHeadless: async () => {
    throw new Error("the headless browser was asked for a PDF");
  },
}));
jest.mock("@/lib/studio/pdf-request", () => ({ signPlanPagesTicket: () => "signed", signPlanReadTicket: () => "read-ticket" }));
jest.mock("@/lib/workboard/job-notes-query", () => ({ staffDisplayNames: async () => new Map() }));

const words = (title: string) => [{ text: title, at: { x: 2000, y: 1600 } }];
const previewsInNode = jest.fn(async (_b: Uint8Array, onProgress?: (d: number, t: number) => void) => {
  const titles = ["COVER PAGE", "LGF PLAN", "GF PLAN", "FF PLAN", "ROOF PLAN", "SECTIONS"];
  clock += 120_000; /* a big set takes its time */
  titles.forEach((_t, i) => onProgress?.(i + 1, titles.length));
  return titles.map((t, i) => ({ n: i + 1, width: 2400, height: 1695, words: words(t), jpeg: "data:image/jpeg;base64,AA==" }));
});
const fullInNode = jest.fn(async (_b: Uint8Array, ns: readonly number[]) => ns.map((n) => ({ n, png: Buffer.from("png"), width: 2400, height: 1695, words: words("PLAN") })));
jest.mock("../plan-draw-node", () => ({
  previewsInNode: (...a: unknown[]) => previewsInNode(...(a as [Uint8Array])),
  fullInNode: (...a: unknown[]) => fullInNode(...(a as [Uint8Array, number[]])),
}));
const readSheet = jest.fn(async (_o: string, s: { floorId: string }) => ({ sheetId: s.floorId, spaces: [{ name: "Living", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }, { name: "Kitchen", points: [{ x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }] }] }));
jest.mock("@/lib/studio/reading-server", () => ({
  READING_MODEL: "claude-opus-5-5",
  readSheet: (...a: unknown[]) => readSheet(...(a as [string, { floorId: string }])),
  readRoof: async () => ({ said: null }),
  readSite: async () => null,
  readDimensions: async () => [],
}));

const fetchMock = jest.fn(async () => new Response("{}"));
global.fetch = fetchMock as unknown as typeof fetch;

import { readPlan } from "../plans-server";

const client = { beta: { messages: { create: jest.fn() } } } as never;
const plan = () => tables.job_plans![0]!;

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  uploads.length = 0;
  clock = 1_000_000;
  jest.spyOn(Date, "now").mockImplementation(() => clock);
  previewsInNode.mockClear();
  fullInNode.mockClear();
  readSheet.mockClear();
  fetchMock.mockClear();
  tables.documents = [{ org_id: "org-1", id: "d-1", file_name: "307 Coonawarra Rd_CDC.pdf", storage_ref: "org-1/d-1.pdf", mime_type: "application/pdf", size_bytes: 11271429, sm8_job_uuid: "job-3570", uploaded_at: "2026-11-19T21:47:52Z" }];
  tables.job_plans = [
    { id: "jplan_1", org_id: "org-1", job_uuid: "job-3570", document_id: "d-1", attachment_id: null, name: "307 Coonawarra Rd_CDC.pdf", source_ref: "org/org-1/plan_1.pdf", source_kind: "pdf", kind: null, page_count: 0, pages: [], reading: null, state: "reading", said: null, added_by: null, added_at: "2026-11-19T21:48:04Z", read_at: null, claimed_at: null, progress: null },
  ];
});

afterEach(() => jest.restoreAllMocks());

it("draws the pages in Node, saves the floors it found, and hands the rest on when the stage ran long", async () => {
  const out = await readPlan("org-1", "jplan_1", "https://app.test", client);
  expect(out).toEqual({ ok: true, state: "reading" });
  expect(previewsInNode).toHaveBeenCalledTimes(1);
  expect(fullInNode).not.toHaveBeenCalled();
  const pages = plan().pages as { n: number; kind: string; name: string; ref: string | null }[];
  expect(pages.filter((p) => p.kind === "floor").map((p) => [p.n, p.name, p.ref])).toEqual([
    [2, "Lower ground", null],
    [3, "Ground floor", null],
    [4, "Level 1", null],
  ]);
  /* the claim let go and the route asked again, signed */
  expect(plan().claimed_at).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe("https://app.test/api/jobs/plans/read");
  expect(plan().progress).toMatchObject({ step: "finding" });
});

it("picks up where it stopped: the floors drawn in full in Node, saved, then read", async () => {
  await readPlan("org-1", "jplan_1", "https://app.test", client);
  clock += 1_000;
  const out = await readPlan("org-1", "jplan_1", "https://app.test", client);
  /* read through (the fake's rooms are too few to call it sure, so it asks for a check) */
  expect(out).toEqual({ ok: true, state: "check", finished: { jobUuid: "job-3570" } });
  expect(previewsInNode).toHaveBeenCalledTimes(1);
  expect(fullInNode).toHaveBeenCalledWith(expect.any(Uint8Array), [2, 3, 4], expect.any(Function));
  const floors = (plan().pages as { kind: string; ref: string | null }[]).filter((p) => p.kind === "floor");
  expect(floors.every((p) => typeof p.ref === "string" && p.ref.endsWith(".png"))).toBe(true);
  expect(readSheet.mock.calls.map((c) => (c[1] as { floorId: string }).floorId)).toEqual(["p2", "p3", "p4"]);
  expect(plan().reading).toMatchObject({ failed: [] });
  expect(plan().progress).toMatchObject({ step: "reading", done: 5, total: 5 });
});
