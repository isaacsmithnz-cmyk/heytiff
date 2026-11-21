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
const pixelsInNode = jest.fn(async (_b: Uint8Array, n: number, times: number) => ({ n, rgba: new Uint8ClampedArray(4), width: n, height: 1, scale: times, words: [] }));
jest.mock("../plan-draw-node", () => ({
  previewsInNode: (...a: unknown[]) => previewsInNode(...(a as [Uint8Array])),
  fullInNode: (...a: unknown[]) => fullInNode(...(a as [Uint8Array, number[]])),
  pixelsInNode: (...a: unknown[]) => pixelsInNode(...(a as [Uint8Array, number, number])),
}));
/* measuring: the lower ground has no wall fill, the ground floor measures, level 1 breaks */
const bed = { name: "Bed 6", named: true, kind: "room", outline: [{ x: 10, y: 10 }, { x: 110, y: 10 }, { x: 110, y: 110 }, { x: 10, y: 110 }], written: "", existing: false, openTo: "", stair: "" };
const readMeasured = jest.fn(async (_page: unknown, _times: number, o: { floorName: string; deadline?: number }) => {
  if (o.floorName === "Level 1") throw new Error("the model was busy");
  return { spaces: [bed], problems: [{ kind: "overlap", room: "Bed 6", said: "Bed 6 and WIR overlap." }], walls: { shade: 127, segs: [], grid: { x: [10, 110], y: [10, 110] }, run: 400 }, rounds: 2 };
});
/* the stage measures in two steps (walls off the pixels, then the rooms named): the one fake stands for both */
const preparing = { now: 0, most: 0, marks: [] as unknown[] };
jest.mock("@/lib/studio/measured-server", () => ({
  /* the pixel fake's width is its page number: page 2, the lower ground, has no wall fill */
  prepareMeasured: async (page: { width: number }) => {
    preparing.most = Math.max(preparing.most, ++preparing.now);
    preparing.marks.push((tables.job_plans![0]!.pages as { n: number; walled?: unknown }[]).find((q) => q.n === page.width)?.walled);
    await Promise.resolve();
    preparing.now--;
    return page.width === 2 ? null : {};
  },
  nameRooms: (_m: unknown, o: { floorName: string; deadline?: number }) => readMeasured(null, 1, o),
}));
const readSheet = jest.fn(async (_o: string, s: { floorId: string }) => ({ sheetId: s.floorId, spaces: [{ name: "Living", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }, { name: "Kitchen", points: [{ x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }] }] }));
jest.mock("@/lib/studio/reading-server", () => ({
  READING_MODEL: "claude-opus-5-5",
  readSheet: (...a: unknown[]) => readSheet(...(a as [string, { floorId: string }])),
  readRoof: async () => ({ said: null }),
  readSite: async () => null,
  readDimensions: async () => [],
  askWith: async () => ({}),
  pngBlock: (b: Buffer) => b,
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
  readMeasured.mockClear();
  Object.assign(preparing, { now: 0, most: 0, marks: [] });
  pixelsInNode.mockClear();
  /* off unless asked for; its own tests turn it on */
  delete process.env.PLANS_MEASURED;
  fetchMock.mockClear();
  tables.documents = [{ org_id: "org-1", id: "d-1", file_name: "307 Coonawarra Rd_CDC.pdf", storage_ref: "org-1/d-1.pdf", mime_type: "application/pdf", size_bytes: 11271429, sm8_job_uuid: "job-3570", uploaded_at: "2026-11-19T21:47:52Z" }];
  tables.job_plans = [
    { id: "jplan_1", org_id: "org-1", job_uuid: "job-3570", document_id: "d-1", attachment_id: null, name: "307 Coonawarra Rd_CDC.pdf", source_ref: "org/org-1/plan_1.pdf", source_kind: "pdf", kind: null, page_count: 0, pages: [], reading: null, state: "reading", said: null, added_by: null, added_at: "2026-11-19T21:48:04Z", read_at: null, claimed_at: null, progress: null },
  ];
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.PLANS_MEASURED;
});

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

describe("with the floors read by measure, when PLANS_MEASURED is 1", () => {
  beforeEach(() => {
    process.env.PLANS_MEASURED = "1";
  });

  it("measures each floor in a stage of its own, keeps what it found on the page, and hands the read on", async () => {
    await readPlan("org-1", "jplan_1", "https://app.test", client);
    clock += 1_000;
    const out = await readPlan("org-1", "jplan_1", "https://app.test", client);
    expect(out).toEqual({ ok: true, state: "reading" });
    /* drawn finer than the raster to measure: an A1 sheet's wall is a few pixels on its raster */
    expect(pixelsInNode.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      [2, 2],
      [3, 2],
      [4, 2],
    ]);
    const walled = Object.fromEntries((plan().pages as { n: number; kind: string; walled?: unknown }[]).filter((p) => p.kind === "floor").map((p) => [p.n, p.walled]));
    expect(walled[2]).toEqual({ none: "Its walls aren't drawn as a fill, so they couldn't be measured" });
    expect(walled[3]).toMatchObject({ spaces: [bed], rounds: 2, grid: { x: [10, 110], y: [10, 110] }, look: [{ kind: "overlap" }] });
    /* a floor that broke is said, and never fails the set */
    expect(walled[4]).toEqual({ none: "the model was busy" });
    /* nothing read by picture yet: that is the next run's five minutes */
    expect(readSheet).not.toHaveBeenCalled();
    expect(plan().claimed_at).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(plan().progress).toMatchObject({ step: "measuring", done: 3, total: 3 });
  });

  it("then reads by picture, and a measured floor's rooms are the measured ones with the picture's rooms as a second reader", async () => {
    for (let i = 0; i < 3; i++) {
      clock += 1_000;
      await readPlan("org-1", "jplan_1", "https://app.test", client);
    }
    expect(pixelsInNode).toHaveBeenCalledTimes(3);
    expect(readSheet).toHaveBeenCalledTimes(3);
    const floors = (plan().reading as { floors: Record<string, { spaces: { name: string }[]; walled?: { rounds: number; look: { kind: string }[] } }[]> }).floors;
    expect(floors.p3[0].spaces.map((s) => s.name)).toEqual(["Bed 6"]);
    expect(floors.p3[0].walled).toMatchObject({ rounds: 2, look: [{ kind: "overlap" }] });
    /* the floors that couldn't be measured are as the picture read them */
    expect(floors.p2[0].spaces.map((s) => s.name)).toEqual(["Living", "Kitchen"]);
    expect(floors.p2[0].walled).toBeUndefined();
    expect(floors.p4[0].spaces.map((s) => s.name)).toEqual(["Living", "Kitchen"]);
  });

  it("draws and measures one floor at a time, each marked unfinished until it lands, and gives the naming a time to be done by", async () => {
    await readPlan("org-1", "jplan_1", "https://app.test", client);
    clock += 1_000;
    const began = clock;
    await readPlan("org-1", "jplan_1", "https://app.test", client);
    /* a floor's pixels are 65 MB twice over: never two floors' at once */
    expect(preparing.most).toBe(1);
    /* a run killed part-way leaves the mark, and the next reads that floor by picture */
    expect(preparing.marks).toEqual([{ none: "The measuring didn't finish" }, { none: "The measuring didn't finish" }, { none: "The measuring didn't finish" }]);
    /* 250 s from the run's start: the route is killed at 300 */
    expect(readMeasured.mock.calls.map((c) => c[2].deadline)).toEqual([began + 250_000, began + 250_000]);
  });

  it("says a floor whose rooms measured but whose picture read failed, and asks for the plan to be checked", async () => {
    readSheet.mockImplementation(async (_o: string, s: { floorId: string }) => {
      if (s.floorId === "p3") throw new Error("Tiff's answer was too long to finish");
      return { sheetId: s.floorId, spaces: [{ name: "Living", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }, { name: "Kitchen", points: [{ x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }] }] };
    });
    for (let i = 0; i < 3; i++) {
      clock += 1_000;
      await readPlan("org-1", "jplan_1", "https://app.test", client);
    }
    const reading = plan().reading as { floors: Record<string, { spaces: { name: string }[] }[]>; failed: { sheetId: string; reason: string }[] };
    /* its measured rooms are kept */
    expect(reading.floors.p3[0].spaces.map((x) => x.name)).toEqual(["Bed 6"]);
    expect(reading.failed).toEqual([expect.objectContaining({ sheetId: "p3", reason: "its rooms were measured, but its doors, windows and notes weren't read (Tiff's answer was too long to finish)" })]);
    expect(plan().state).toBe("check");
    readSheet.mockImplementation(async (_o: string, s: { floorId: string }) => ({ sheetId: s.floorId, spaces: [{ name: "Living", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }, { name: "Kitchen", points: [{ x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }] }] }));
  });

  it("isn't tried again on a set it has been through", async () => {
    for (let i = 0; i < 4; i++) {
      clock += 1_000;
      await readPlan("org-1", "jplan_1", "https://app.test", client);
    }
    expect(pixelsInNode).toHaveBeenCalledTimes(3);
  });
});

it("measures nothing unless it is switched on", async () => {
  await readPlan("org-1", "jplan_1", "https://app.test", client);
  clock += 1_000;
  await readPlan("org-1", "jplan_1", "https://app.test", client);
  expect(readMeasured).not.toHaveBeenCalled();
  expect(pixelsInNode).not.toHaveBeenCalled();
});
