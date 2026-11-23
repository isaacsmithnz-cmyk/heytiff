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
/* the schedule page prints its mark and its figures, as a schedule does: a size it doesn't print is no size of the architect's */
const printedSchedule = () => [...words("PLAN"), ...(scheduleOn.prints ? ["GW.21", "750", "1800", "300"] : ["GW.21"]).map((text, i) => ({ text, at: { x: 100 + 60 * i, y: 100 } }))];
const fullInNode = jest.fn(async (_b: Uint8Array, ns: readonly number[]) => ns.map((n) => ({ n, png: Buffer.from("png"), width: 2400, height: 1695, words: n === scheduleOn.page ? printedSchedule() : words("PLAN") })));
const pixelsInNode = jest.fn(async (_b: Uint8Array, n: number, times: number) => ({ n, rgba: new Uint8ClampedArray(4), width: n, height: 1, scale: times, words: [] }));
/* the drawing file's shapes: none drawn as walls, unless a test gives a floor some */
const fileFloors = new Map<number, { fills: Fill[]; words: { text: string; at: { x: number; y: number } }[] }>();
/* a roof plan's lines and words in its points, on the pages a test draws one */
const roofPages = new Map<number, { lines: Line[]; words: { text: string; at: { x: number; y: number } }[] }>();
const vectorsInNode = jest.fn(async (_b: Uint8Array, n: number) => {
  const roof = roofPages.get(n);
  /* its words on the walls' grid, two pixels a point */
  if (roof) return { n, width: 400, height: 300, rasterScale: 2, fills: [], lines: roof.lines, words: roof.words.map((w) => ({ text: w.text, at: { x: w.at.x * 2, y: w.at.y * 2 } })) };
  return { n, width: 400, height: 300, rasterScale: 2, fills: fileFloors.get(n)?.fills ?? [], words: fileFloors.get(n)?.words ?? [] };
});
/* the set's pages' words: none a schedule, unless a test makes page 6 one */
const scheduleOn = { page: 0, prints: true };
const textsInNode = jest.fn(async (_b: Uint8Array, ns: readonly number[]) => ns.map((n) => ({ n, words: roofPages.get(n)?.words ?? (n === scheduleOn.page ? [{ text: "WINDOW SCHEDULE" }] : [{ text: "SECTION A" }]) })));
jest.mock("../plan-draw-node", () => ({
  textsInNode: (...a: unknown[]) => textsInNode(...(a as [Uint8Array, number[]])),
  vectorsInNode: (...a: unknown[]) => vectorsInNode(...(a as [Uint8Array, number])),
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
const readRoof = jest.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ said: null }));
const readSite = jest.fn(async (..._a: unknown[]): Promise<unknown> => null);
const readSchedule = jest.fn(async (_png: Buffer, _words: unknown[]) => ({ items: [{ mark: "GW.21", type: "W.05", kind: "window", width_mm: 750, height_mm: 1800, sill_mm: 300 }] }));
/* the lengths printed along a floor's dimension lines: none, unless a test prints some */
const readDimensions = jest.fn(async (_o: string, _s: { floorId: string }): Promise<unknown[]> => []);
const readSheet = jest.fn(async (_o: string, s: { floorId: string }) => ({ sheetId: s.floorId, spaces: [{ name: "Living", written: "", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }, { name: "Kitchen", written: "", points: [{ x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }] }] }));
jest.mock("@/lib/studio/reading-server", () => ({
  READING_MODEL: "claude-opus-5-5",
  readSheet: (...a: unknown[]) => readSheet(...(a as [string, { floorId: string }])),
  readRoof: (...a: unknown[]) => readRoof(...a),
  readRoofSlices: async (o: unknown, pdf: unknown, sheets: unknown, pages: { from: number }, want: { shape: boolean; heights: boolean }) => {
    /* the one roof read the tests answer, split as the slices give it */
    const whole = Promise.resolve(readRoof(o, pdf, sheets, undefined, pages.from)) as Promise<Record<string, unknown>>;
    return {
      at: [],
      shape: want.shape ? whole.then((r) => ({ parts: (r.parts as unknown[]) ?? [], material: (r.material as string) ?? "" })) : null,
      heights: want.heights ? whole.then((r) => ({ levels: (r.levels as unknown[]) ?? [], raked: (r.raked as unknown[]) ?? [], roofSpace: (r.roofSpace as string) ?? "", pitches: [], ...(r.subfloor ? { subfloor: r.subfloor } : {}) })) : null,
    };
  },
  readSite: (...a: unknown[]) => readSite(...a),
  readDimensions: (...a: unknown[]) => readDimensions(...(a as [string, { floorId: string }])),
  readSchedule: (...a: unknown[]) => readSchedule(...(a as [Buffer, unknown[]])),
  askWith: async () => ({}),
  pngBlock: (b: Buffer) => b,
}));

const fetchMock = jest.fn(async () => new Response("{}"));
global.fetch = fetchMock as unknown as typeof fetch;

import type { Fill, Line } from "@/lib/studio/vector/fills";
import type { PlanReading } from "@/lib/studio/reading";
import { roomWords, threeRooms } from "@/lib/studio/vector/__fixtures__/three-rooms";
import { hipRoof } from "@/lib/studio/vector/__fixtures__/hip-roof";
import type { JobPlanPage } from "../plans";
import { readPlan, roofFacesOf } from "../plans-server";

/* Tiff's look at the page the words leave undecided, the cover: not a floor */
const client = { beta: { messages: { create: jest.fn(async () => ({ content: [{ type: "text", text: JSON.stringify({ pages: [{ page: 1, kind: "other", level_name: "", level: 0 }] }) }] })) } } } as never;
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
  vectorsInNode.mockClear();
  readSchedule.mockClear();
  readRoof.mockClear();
  readSite.mockClear();
  scheduleOn.page = 0;
  scheduleOn.prints = true;
  fileFloors.clear();
  roofPages.clear();
  /* off unless asked for; its own tests turn it on */
  delete process.env.PLANS_MEASURED;
  fetchMock.mockClear();
  tables.documents = [{ org_id: "org-1", id: "d-1", file_name: "307 Deserunt Rd_CDC.pdf", storage_ref: "org-1/d-1.pdf", mime_type: "application/pdf", size_bytes: 11271429, sm8_job_uuid: "job-3570", uploaded_at: "2026-11-19T21:47:52Z" }];
  tables.job_plans = [
    { id: "jplan_1", org_id: "org-1", job_uuid: "job-3570", document_id: "d-1", attachment_id: null, name: "307 Deserunt Rd_CDC.pdf", source_ref: "org/org-1/plan_1.pdf", source_kind: "pdf", kind: null, page_count: 0, pages: [], reading: null, state: "reading", said: null, added_by: null, added_at: "2026-11-19T21:48:04Z", read_at: null, claimed_at: null, progress: null },
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
  /* the floors drawn, and their walls looked for in the file: then a run of its own for the read */
  expect(await readPlan("org-1", "jplan_1", "https://app.test", client)).toEqual({ ok: true, state: "reading" });
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
  expect(plan().progress).toMatchObject({ step: "reading", done: 6, total: 6 });
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
      return { sheetId: s.floorId, spaces: [{ name: "Living", written: "", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }, { name: "Kitchen", written: "", points: [{ x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }] }] };
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
    readSheet.mockImplementation(async (_o: string, s: { floorId: string }) => ({ sheetId: s.floorId, spaces: [{ name: "Living", written: "", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }, { name: "Kitchen", written: "", points: [{ x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }] }] }));
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

describe("with a floor's rooms read from the drawing file", () => {
  it("takes them as its rooms, and hands the read by picture to a run of its own", async () => {
    fileFloors.set(3, { fills: threeRooms(), words: roomWords });
    await readPlan("org-1", "jplan_1", "https://app.test", client);
    clock += 1_000;
    expect(await readPlan("org-1", "jplan_1", "https://app.test", client)).toEqual({ ok: true, state: "reading" });
    expect(readSheet).not.toHaveBeenCalled();
    clock += 1_000;
    const out = await readPlan("org-1", "jplan_1", "https://app.test", client);
    expect(out).toMatchObject({ ok: true, finished: { jobUuid: "job-3570" } });
    /* each floor's file read once for its walls, then the two not read from it again, to put the picture's rooms on its walls */
    expect(vectorsInNode.mock.calls.map((c) => c[1])).toEqual([2, 3, 4, 2, 4]);
    /* no model was asked to measure */
    expect(pixelsInNode).not.toHaveBeenCalled();
    const walled = Object.fromEntries((plan().pages as { n: number; kind: string; walled?: unknown }[]).filter((p) => p.kind === "floor").map((p) => [p.n, p.walled]));
    expect(walled[2]).toEqual({ none: "Its walls aren't drawn in the file, filled or in lines" });
    expect(walled[3]).toMatchObject({ from: "file", rounds: 0, look: [] });
    const floors = (plan().reading as { floors: Record<string, { spaces: { name: string }[] }[]> }).floors;
    /* the picture read leads (this fake's rooms have no outlines, so none takes the file's), and the file's named rooms are added */
    expect(floors.p3[0].spaces.map((s) => s.name)).toEqual(["Living", "Kitchen", "Bed 1", "Living", "Ensuite"]);
    expect(floors.p2[0].spaces.map((s) => s.name)).toEqual(["Living", "Kitchen"]);
  });

  it("isn't tried when PLANS_VECTOR is 0", async () => {
    process.env.PLANS_VECTOR = "0";
    try {
      await readPlan("org-1", "jplan_1", "https://app.test", client);
      clock += 1_000;
      await readPlan("org-1", "jplan_1", "https://app.test", client);
      expect(vectorsInNode).not.toHaveBeenCalled();
    } finally {
      delete process.env.PLANS_VECTOR;
    }
  });
});

describe("the set's door and window schedule", () => {
  it("is found among the pages, read once, and gives each opening its size by its mark", async () => {
    scheduleOn.page = 6;
    readSheet.mockImplementation((async (_o: string, sh: { floorId: string }) => ({
      sheetId: sh.floorId,
      spaces: [{ name: "Living", written: "", outline: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }],
      openings: [{ kind: "window", tag: "GW.21", a: { x: 0, y: 0 }, b: { x: 50, y: 0 }, widthMm: 900, room: "Living", external: true, facing: "N" }],
    })) as never);
    try {
      for (let i = 0; i < 3; i++) {
        clock += 1_000;
        await readPlan("org-1", "jplan_1", "https://app.test", client);
      }
    } finally {
      readSheet.mockImplementation(async (_o: string, sh: { floorId: string }) => ({ sheetId: sh.floorId, spaces: [{ name: "Living", written: "", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }, { name: "Kitchen", written: "", points: [{ x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }] }] }));
    }
    /* only the pages that aren't floors are looked through, and only the schedule drawn and read */
    expect(textsInNode.mock.calls.at(-1)![1]).toEqual([1, 5, 6]);
    expect(readSchedule).toHaveBeenCalledTimes(1);
    const reading = plan().reading as { schedule?: unknown; floors: Record<string, { openings: { widthMm: number; heightMm?: number; sillMm?: number }[] }[]> };
    expect(reading.schedule).toEqual({ pages: [6], marks: 1, matched: 3 });
    expect(reading.floors.p3[0].openings[0]).toMatchObject({ widthMm: 750, heightMm: 1800, sillMm: 300 });
  });

  it("sizes nothing by a schedule whose page doesn't print the size it gave", async () => {
    scheduleOn.page = 6;
    /* the page prints the mark, not the 750 the read gave it */
    scheduleOn.prints = false;
    for (let i = 0; i < 3; i++) {
      clock += 1_000;
      await readPlan("org-1", "jplan_1", "https://app.test", client);
    }
    expect((plan().reading as { schedule?: unknown }).schedule).toBeUndefined();
  });

  it("finds a window's mark beside it at its set's scale, where the floor prints none and measures 2% off it", async () => {
    scheduleOn.page = 6;
    /* the ground floor prints 1:50 @ A1 (17.52 mm a pixel); level 1 prints none and has its mark 51 px from its window */
    fullInNode.mockImplementationOnce(async (_b: Uint8Array, ns: readonly number[]) =>
      ns.map((n) => ({ n, png: Buffer.from("png"), width: 2400, height: 1695, words: n === 3 ? [...words("PLAN"), ...words("SCALE"), ...words("1:50 @ A1")] : n === 4 ? [...words("PLAN"), { text: "GW.21", at: { x: 125, y: 151 } }] : n === scheduleOn.page ? printedSchedule() : words("PLAN") })),
    );
    /* level 1's dimension lines give 17.87 mm a pixel: on its own, 900 mm is 50.4 px, short of the mark; at its set's 1:50, 51.4 */
    readDimensions.mockImplementation(async (_o: string, sh: { floorId: string }) =>
      sh.floorId === "p4"
        ? [
            { mm: 5000, a: { x: 0, y: 0 }, b: { x: 5000 / 17.87, y: 0 }, what: "" },
            { mm: 3600, a: { x: 0, y: 0 }, b: { x: 0, y: 3600 / 17.87 }, what: "" },
          ]
        : [],
    );
    readSheet.mockImplementation((async (_o: string, sh: { floorId: string }) => ({
      sheetId: sh.floorId,
      spaces: [{ name: "Living", written: "", outline: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }],
      openings: [{ kind: "window", tag: "", a: { x: 100, y: 100 }, b: { x: 150, y: 100 }, widthMm: 900, room: "Living", external: true, facing: "N" }],
    })) as never);
    try {
      for (let i = 0; i < 3; i++) {
        clock += 1_000;
        await readPlan("org-1", "jplan_1", "https://app.test", client);
      }
    } finally {
      readDimensions.mockImplementation(async () => []);
      readSheet.mockImplementation(async (_o: string, sh: { floorId: string }) => ({ sheetId: sh.floorId, spaces: [{ name: "Living", written: "", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }, { name: "Kitchen", written: "", points: [{ x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }] }] }));
    }
    const reading = plan().reading as { floors: Record<string, { openings: { tag: string; widthMm: number }[] }[]> };
    expect(reading.floors.p4[0].openings[0]).toMatchObject({ tag: "GW.21", widthMm: 750 });
  });
});

describe("a roof read that runs long", () => {
  it("doesn't lose the floors: they are saved, and the roof and the site get a run of their own", async () => {
    /* the floors take most of the run, and the roof isn't back when the time is up */
    readSheet.mockImplementationOnce(async (_o: string, sh: { floorId: string }) => {
      clock += 240_000;
      return { sheetId: sh.floorId, spaces: [{ name: "Living", written: "", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }, { name: "Kitchen", written: "", points: [{ x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }] }] };
    });
    /* back only once the run has moved on: a real delay lost the race on a slow runner, where the floors took longer than it (CI, #1676) */
    let roofBack = () => {};
    readRoof.mockImplementationOnce(() => new Promise((r) => (roofBack = () => r({ said: null, levels: [], parts: [], raked: [], material: "", roofSpace: "" }))));
    await readPlan("org-1", "jplan_1", "https://app.test", client);
    clock += 1_000;
    await readPlan("org-1", "jplan_1", "https://app.test", client);
    clock += 1_000;
    expect(await readPlan("org-1", "jplan_1", "https://app.test", client)).toEqual({ ok: true, state: "reading" });
    const kept = plan().reading as { partial?: boolean; floors: Record<string, unknown[]>; roof?: unknown };
    expect(kept.partial).toBe(true);
    expect(Object.keys(kept.floors).sort()).toEqual(["p2", "p3", "p4"]);
    expect(kept.roof).toBeUndefined();
    expect(plan().state).toBe("reading");
    roofBack();
    /* the next run reads the roof alone, and the plan is read */
    readSheet.mockClear();
    clock += 1_000;
    const out = await readPlan("org-1", "jplan_1", "https://app.test", client);
    expect(out).toMatchObject({ ok: true, finished: { jobUuid: "job-3570" } });
    expect(readSheet).not.toHaveBeenCalled();
    expect(readRoof).toHaveBeenCalledTimes(2);
    const read = plan().reading as { partial?: boolean; roof?: unknown; floors: Record<string, unknown[]> };
    expect(read.partial).toBeUndefined();
    expect(read.roof).toBeDefined();
    expect(Object.keys(read.floors).sort()).toEqual(["p2", "p3", "p4"]);
  });
});

describe("the roof's faces off the roof plan's lines", () => {
  const box = (x0: number, y0: number, x1: number, y1: number) => [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  const roof = { levels: [{ floorId: "p3", ceilingMm: 2700, floorZoneMm: 0, source: "Sections" }], parts: [], raked: [], material: "", roofSpace: "" };
  /* the read's floors as far as the floors go, the roof read, and its run's time taken by them */
  const readTaking = async (ms: number) => {
    readSheet.mockImplementationOnce(async (_o: string, sh: { floorId: string }) => {
      clock += ms;
      return { sheetId: sh.floorId, spaces: [{ name: "Living", written: "", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }, { name: "Kitchen", written: "", points: [{ x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }] }] };
    });
    readRoof.mockImplementationOnce(async () => ({ said: null, ...roof }));
    for (let i = 0; i < 3; i++) {
      clock += 1_000;
      await readPlan("org-1", "jplan_1", "https://app.test", client);
    }
  };

  it("are looked for by a time of their own when the floors took the readers' time", async () => {
    /* the roof plan on page 5, its lines not yet drawn to read */
    roofPages.set(5, { lines: [], words: hipRoof().words });
    await readTaking(240_000);
    expect(vectorsInNode.mock.calls.map((c) => c[1])).toContain(5);
    expect(plan().state).not.toBe("reading");
  });

  it("aren't looked for once the run is nearly out of time, and it says so", async () => {
    roofPages.set(5, { lines: [], words: hipRoof().words });
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    await readTaking(275_000);
    expect(vectorsInNode.mock.calls.map((c) => c[1])).not.toContain(5);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("the roof's faces weren't read off the roof plan, the run was out of time"));
  });

  /* the ground floor on a page the roof plans' size, two pixels a point: a room inside walls 12.5 pt in from the eaves */
  const ground: JobPlanPage = { n: 3, kind: "floor", name: "Ground floor", level: 0, ref: "org/org-1/p3.png", preview: null, width: 800, height: 600, mmPerPx: 17.5, scale: "1:100" };
  const other = (n: number): JobPlanPage => ({ n, kind: "other", name: "", level: null, ref: null, preview: null, width: 800, height: 600, mmPerPx: null, scale: null });
  const reading: PlanReading = {
    at: "2026-11-23T00:00:00Z",
    model: "m",
    failed: [],
    floors: {
      p3: [
        {
          sheetId: "p3",
          spaces: [{ name: "Living", named: true, kind: "room", outline: box(240, 240, 560, 360), written: "", existing: false, openTo: "", stair: "" }],
          openings: [],
          marks: [],
          furniture: [],
          checklist: [],
          flags: [],
          planUp: "",
          walled: { grid: { x: [], y: [] }, rounds: 0, look: [], walls: [[box(224.5, 224.5, 575.5, 375.5), box(240, 240, 560, 360)]] },
        },
      ],
    },
    roof,
  };
  const set = [ground, other(5), other(6)];

  it("are the one roof plan's when another page draws the same roof again, which is said to be left out", async () => {
    roofPages.set(5, hipRoof());
    roofPages.set(6, hipRoof());
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    const got = await roofFacesOf(new Uint8Array(), set, reading, Infinity);
    expect(got?.faces.map((f) => f.page)).toEqual([5, 5, 5, 5]);
    /* 25 px in at 17.5 mm a pixel */
    expect(got?.faces.every((f) => f.overhangMm === 438)).toBe(true);
    expect(log).toHaveBeenCalledWith("[job-plans] p6's roof faces are p5's read again, and are left out");
  });

  it("are none when two pages place different roofs, never the one that places most of them: which is the roof isn't known", async () => {
    /* the existing roof a tenth bigger all round than the proposed one, its eaves still alike on opposite sides */
    const r = hipRoof();
    const grown = ([x, y]: readonly [number, number]): [number, number] => [200 + (x - 200) * 1.1, 150 + (y - 150) * 1.1];
    roofPages.set(5, {
      lines: r.lines.map((l) => ({ ...l, a: grown(l.a), b: grown(l.b) })),
      words: r.words.map((w) => {
        const [x, y] = grown([w.at.x, w.at.y]);
        return { ...w, at: { x, y } };
      }),
    });
    roofPages.set(6, hipRoof());
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    expect(await roofFacesOf(new Uint8Array(), set, reading, Infinity)).toBeNull();
    expect(log).toHaveBeenCalledWith("[job-plans] p5 and p6 place different roofs: which is the roof isn't known");
  });

  it("stop at the run's time for them between two roof plan pages, with the pages' read before it, and say so", async () => {
    roofPages.set(5, hipRoof());
    roofPages.set(6, hipRoof());
    const drawn = vectorsInNode.getMockImplementation()!;
    vectorsInNode.mockImplementationOnce(async (b: Uint8Array, n: number) => {
      clock += 5_000;
      return drawn(b, n);
    });
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    const got = await roofFacesOf(new Uint8Array(), set, reading, clock + 2_000);
    expect(vectorsInNode.mock.calls.map((c) => c[1])).toEqual([5]);
    expect(got?.faces.map((f) => f.page)).toEqual([5, 5, 5, 5]);
    expect(log).toHaveBeenCalledWith("[job-plans] the roof's faces were read off 1 of 2 pages, the run was out of time");
  });
});

describe("a site read that fails", () => {
  it("leaves the site unread, not none, so it is read again", async () => {
    /* a set too large to send throws (reading-server readSite) */
    readSite.mockRejectedValueOnce(new Error("The drawing set is too large to read the site from"));
    await readPlan("org-1", "jplan_1", "https://app.test", client);
    clock += 1_000;
    await readPlan("org-1", "jplan_1", "https://app.test", client);
    clock += 1_000;
    expect(await readPlan("org-1", "jplan_1", "https://app.test", client)).toMatchObject({ ok: true, finished: { jobUuid: "job-3570" } });
    expect(readSite).toHaveBeenCalledTimes(1);
    /* null would say the set has no site plan, and it would never be read again */
    expect("site" in (plan().reading as Record<string, unknown>)).toBe(false);
  });
});
