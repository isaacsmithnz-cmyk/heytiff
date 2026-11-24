/** @jest-environment node */
/* How a plan's read is run (plans-server.ts readPlan, jobPlanRooms,
   addJobPlans): what a run that runs out of time keeps and hands on, what a
   hand-on that can't go says, what a failed look, roof or site read leaves,
   and that what a person saved while Tiff read isn't written over. The
   outside review of the read's orchestration, 22 November 2026. The
   database, the storage, Node's drawing and the readers are fakes; the
   sets are made up. */

type Row = Record<string, unknown>;
type DbError = { code: string; message: string };
const tables: Record<string, Row[]> = {};
let clock = 0;
/* a write the database turns away, and what it says */
const refuse: { update: ((table: string, patch: Row) => DbError | null) | null; insert: ((table: string, row: Row) => DbError | null) | null } = { update: null, insert: null };

jest.mock("server-only", () => ({}));
jest.mock("@/lib/supabase-server", () => {
  const query = (table: string) => {
    const filters: [string, unknown][] = [];
    /* a read's claim, "claimed_at.is.null,claimed_at.lt.<when>": none, or one from before then */
    let claimedBefore: string | null = null;
    let update: Row | null = null;
    let insert: Row | null = null;
    const rows = () => (tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v) && (claimedBefore == null || r.claimed_at == null || String(r.claimed_at) < claimedBefore));
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push([c, v]), q),
      neq: () => q,
      or: (expr: string) => ((claimedBefore = /^claimed_at\.is\.null,claimed_at\.lt\.(.+)$/.exec(expr)?.[1] ?? null), q),
      in: () => q,
      not: () => q,
      order: () => q,
      limit: () => q,
      update: (r: Row) => ((update = r), q),
      insert: (r: Row) => ((insert = r), q),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
        const error = (update && refuse.update?.(table, update)) || (insert && refuse.insert?.(table, insert)) || null;
        if (error) return Promise.resolve({ data: null, error }).then(res, rej);
        if (insert) (tables[table] ??= []).push(insert);
        const hit = insert ? [insert] : rows();
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
          upload: async () => ({ error: null }),
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

/* the set's small pages, by their titles: a test sets them */
const titles = { now: ["COVER PAGE", "GF PLAN", "SECTIONS"] };
const previewsInNode = jest.fn(async () => {
  clock += 120_000;
  return titles.now.map((t, i) => ({ n: i + 1, width: 2400, height: 1695, words: [{ text: t, at: { x: 2000, y: 1600 } }], jpeg: "data:image/jpeg;base64,AA==" }));
});
/* the schedule page prints its mark and its figures, as a schedule does: a size it doesn't print is no size of the architect's */
const fullInNode = jest.fn(async (_b: Uint8Array, ns: readonly number[]) =>
  ns.map((n) => ({ n, png: Buffer.from("png"), width: 2400, height: 1695, words: ["DOOR SCHEDULE", "GD.10", "820", "2040"].map((text, i) => ({ text, at: { x: 10 + 80 * i, y: 10 } })) })),
);
/* the file's shapes: none, so no floor is read from the file; how many are opened at once is kept */
const opening = { now: 0, most: 0 };
const vectorsInNode = jest.fn(async (_b: Uint8Array, n: number) => {
  opening.most = Math.max(opening.most, ++opening.now);
  await new Promise((r) => setImmediate(r));
  opening.now--;
  return { n, width: 1200, height: 847, rasterScale: 2, fills: [], lines: [], words: [] };
});
/* page 9 of a set is its door schedule, when it has one */
const textsInNode = jest.fn(async (_b: Uint8Array, ns: readonly number[]) => ns.map((n) => ({ n, words: n === 9 ? [{ text: "DOOR SCHEDULE" }] : [{ text: "SECTION A" }] })));
jest.mock("../plan-draw-node", () => ({
  textsInNode: (...a: unknown[]) => textsInNode(...(a as [Uint8Array, number[]])),
  vectorsInNode: (...a: unknown[]) => vectorsInNode(...(a as [Uint8Array, number])),
  previewsInNode: () => previewsInNode(),
  fullInNode: (...a: unknown[]) => fullInNode(...(a as [Uint8Array, number[]])),
  pixelsInNode: async () => {
    throw new Error("nothing is measured by its pixels here");
  },
}));
jest.mock("@/lib/studio/measured-server", () => ({ prepareMeasured: async () => null, nameRooms: async () => null }));
/* a floor's sides put on the drawing's walls: each call kept, so a test can see the scale it was done at */
const snapped = jest.fn();
jest.mock("@/lib/studio/vector/snap", () => {
  const real = jest.requireActual<typeof import("@/lib/studio/vector/snap")>("@/lib/studio/vector/snap");
  return { ...real, snapped: (...a: Parameters<typeof real.snapped>) => (snapped(...a), real.snapped(...a)) };
});

const room = (name: string, x: number) => ({ name, named: true, kind: "room", outline: [{ x, y: 0 }, { x: x + 100, y: 0 }, { x: x + 100, y: 100 }, { x, y: 100 }], written: "", existing: false, openTo: "", stair: "" });
const door = { kind: "door", tag: "", a: { x: 0, y: 100 }, b: { x: 100, y: 100 }, widthMm: 900, room: "Living", external: false, facing: "" };
const sheetOf = (floorId: string) => ({ sheetId: floorId, spaces: [room("Living", 0), room("Kitchen", 100)], openings: [{ ...door }] });
const readSheet = jest.fn(async (_o: string, s: { floorId: string }) => sheetOf(s.floorId));
/* a floor's read that isn't back till the test is over */
const hung: (() => void)[] = [];
const hang = (floorId: string) => new Promise<ReturnType<typeof sheetOf>>((r) => hung.push(() => r(sheetOf(floorId))));
const readRoof = jest.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ said: null, levels: [], parts: [], raked: [], material: "", roofSpace: "" }));
/* what each run asked of the roof's slices, and a test's heights slice held so it is late */
const slicesAsked: { shape: boolean; heights: boolean }[] = [];
const heightsHeld = { on: false };
const readSite = jest.fn(async (..._a: unknown[]): Promise<unknown> => null);
const readDimensions = jest.fn(async (..._a: unknown[]): Promise<unknown[]> => []);
const scheduleRead = async () => ({ items: [{ mark: "GD.10", type: "", kind: "door", width_mm: 820, height_mm: 2040, sill_mm: 0 }] });
const readSchedule = jest.fn(scheduleRead);
jest.mock("@/lib/studio/reading-server", () => ({
  READING_MODEL: "claude-opus-5-5",
  readSheet: (...a: unknown[]) => readSheet(...(a as [string, { floorId: string }])),
  readRoof: (...a: unknown[]) => readRoof(...a),
  readRoofSlices: async (o: unknown, pdf: unknown, sheets: unknown, pages: { from: number }, want: { shape: boolean; heights: boolean }) => {
    /* the one roof read the tests answer, split as the slices give it */
    slicesAsked.push(want);
    const whole = Promise.resolve(readRoof(o, pdf, sheets, undefined, pages.from)) as Promise<Record<string, unknown>>;
    return {
      at: [],
      shape: want.shape ? whole.then((r) => ({ parts: (r.parts as unknown[]) ?? [], material: (r.material as string) ?? "" })) : null,
      heights: !want.heights ? null : heightsHeld.on ? new Promise(() => {}) : whole.then((r) => ({ levels: (r.levels as unknown[]) ?? [], raked: (r.raked as unknown[]) ?? [], roofSpace: (r.roofSpace as string) ?? "", pitches: [], ...(r.subfloor ? { subfloor: r.subfloor } : {}) })),
    };
  },
  readSite: (...a: unknown[]) => readSite(...a),
  readDimensions: (...a: unknown[]) => readDimensions(...a),
  readSchedule: () => readSchedule(),
  askWith: async () => ({}),
  pngBlock: (b: Buffer) => b,
}));

/* the read route, asked by the server: answered as a test says */
const fetchMock = jest.fn(async (..._a: unknown[]): Promise<Response> => new Response("{}"));
global.fetch = fetchMock as unknown as typeof fetch;

import { addJobPlans, choosePlanFloors, jobPlanRooms, readJobPlan, readPlan, readPlanAgain, roofPagesOf } from "../plans-server";
import { plansToAskAgain } from "../plans-client";
import { planLine } from "../plans";

/* Tiff's look at the pages the words leave undecided: each said to be "other", unless a test says otherwise */
type Look = { messages: { content: { type: string; text?: string }[] }[] };
/* the pages a look was shown */
const shownIn = (o: Look) => o.messages[0].content.flatMap((b) => (b.type === "text" && /^Page \d+:$/.test(b.text ?? "") ? [Number(b.text!.slice(5, -1))] : []));
const look = jest.fn(async (o: Look) => ({ content: [{ type: "text", text: JSON.stringify({ pages: shownIn(o).map((page) => ({ page, kind: "other", level_name: "", level: 0 })) }) }] }));
const client = { beta: { messages: { create: (o: never) => look(o) } } } as never;
const plan = () => tables.job_plans![0]!;
const run = () => readPlan("org-1", "jplan_1", "https://app.test", client);
/* a run, and each run it hands on to, as the read route would: what the last one says */
const runAll = async () => {
  for (let i = 0; i < 6; i++) {
    const out = await run();
    if (!(out.ok && out.state === "reading")) return out;
    clock += 1_000;
  }
  throw new Error("the read never finished");
};
/* the plan's row line as the job's Plans shows it */
const rowLine = async () => planLine({ ...(await readJobPlan("org-1", "jplan_1"))!, thumbs: {}, usedBy: 0 });

/* a set drawn already, its floors found and drawn in full: the next run is the read */
const floorPage = (n: number, level: number, name: string, extra: Row = {}) => ({ n, kind: "floor", name, level, ref: `org/org-1/p${n}.png`, preview: null, width: 2400, height: 1695, mmPerPx: null, scale: null, walled: { none: "Its walls aren't drawn in the file, filled or in lines" }, ...extra });
const otherPage = (n: number) => ({ n, kind: "other", name: "", level: null, ref: null, preview: null, width: 2400, height: 1695, mmPerPx: null, scale: null });
const drawn = (pages: Row[], more: Row = {}) => Object.assign(plan(), { pages, page_count: pages.length, ...more });
const threeFloors = () => drawn([otherPage(1), floorPage(2, 0, "Ground floor"), floorPage(3, 1, "Level 1"), floorPage(4, 2, "Level 2")]);

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  clock = 1_000_000;
  jest.spyOn(Date, "now").mockImplementation(() => clock);
  for (const f of [previewsInNode, fullInNode, vectorsInNode, textsInNode, readSheet, readRoof, readSite, readDimensions, readSchedule, fetchMock, look, snapped]) f.mockClear();
  readSheet.mockImplementation(async (_o: string, s: { floorId: string }) => sheetOf(s.floorId));
  readSite.mockImplementation(async () => null);
  slicesAsked.length = 0;
  heightsHeld.on = false;
  readRoof.mockImplementation(async () => ({ said: null, levels: [], parts: [], raked: [], material: "", roofSpace: "" }));
  readDimensions.mockImplementation(async () => []);
  readSchedule.mockImplementation(scheduleRead);
  fetchMock.mockImplementation(async () => new Response("{}"));
  Object.assign(opening, { now: 0, most: 0 });
  Object.assign(refuse, { update: null, insert: null });
  titles.now = ["COVER PAGE", "GF PLAN", "SECTIONS"];
  tables.documents = [
    { org_id: "org-1", id: "d-1", file_name: "Plans.pdf", storage_ref: "org-1/d-1.pdf", mime_type: "application/pdf", size_bytes: 1000, sm8_job_uuid: "job-1", uploaded_at: "2026-11-19T21:47:52Z" },
    { org_id: "org-1", id: "d-2", file_name: "Plans rev B.pdf", storage_ref: "org-1/d-2.pdf", mime_type: "application/pdf", size_bytes: 2000, sm8_job_uuid: "job-1", uploaded_at: "2026-11-19T21:47:52Z" },
  ];
  tables.job_plans = [
    { id: "jplan_1", org_id: "org-1", job_uuid: "job-1", document_id: "d-1", attachment_id: null, name: "Plans.pdf", source_ref: "org/org-1/plan_1.pdf", source_kind: "pdf", kind: null, page_count: 0, pages: [], reading: null, state: "reading", said: null, added_by: null, added_at: "2026-11-19T21:48:04Z", read_at: null, claimed_at: null, progress: null },
  ];
});

afterEach(() => {
  for (const back of hung.splice(0)) back();
  jest.restoreAllMocks();
});

describe("a floor read that runs past the run's time", () => {
  it("keeps the floors that came back, and hands the rest to a run of their own", async () => {
    threeFloors();
    readSheet.mockImplementation(async (_o: string, s: { floorId: string }) => {
      if (s.floorId === "p2") clock += 240_000;
      if (s.floorId === "p4") return hang(s.floorId);
      return sheetOf(s.floorId);
    });
    readRoof.mockImplementation(async () => ({ said: null, levels: [], parts: [], raked: [], material: "metal", roofSpace: "" }));
    expect(await run()).toEqual({ ok: true, state: "reading" });
    const kept = plan().reading as { partial?: boolean; late?: number; floors: Record<string, unknown[]>; failed: unknown[]; roof?: { material: string } };
    expect(kept.partial).toBe(true);
    expect(kept.late).toBe(1);
    expect(Object.keys(kept.floors).sort()).toEqual(["p2", "p3"]);
    expect(kept.failed).toEqual([]);
    /* the roof came back in time, so it is kept with the floors */
    expect(kept.roof?.material).toBe("metal");
    expect(plan().state).toBe("reading");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    /* the next run reads only the floor that didn't come back, and not the roof again */
    readSheet.mockClear();
    readSheet.mockImplementation(async (_o: string, s: { floorId: string }) => sheetOf(s.floorId));
    clock += 1_000;
    const out = await run();
    expect(out).toMatchObject({ ok: true, finished: { jobUuid: "job-1" } });
    expect(readSheet.mock.calls.map((c) => c[1].floorId)).toEqual(["p4"]);
    expect(readRoof).toHaveBeenCalledTimes(1);
    const read = plan().reading as { partial?: boolean; late?: number; floors: Record<string, unknown[]>; roof?: { material: string } };
    expect(read.partial).toBeUndefined();
    expect(read.late).toBeUndefined();
    expect(Object.keys(read.floors).sort()).toEqual(["p2", "p3", "p4"]);
    expect(read.roof?.material).toBe("metal");
  });

  it("fails the plan, saying which floor, when it runs out twice, and Read again goes on from there", async () => {
    threeFloors();
    readSheet.mockImplementation(async (_o: string, s: { floorId: string }) => {
      if (s.floorId === "p4") {
        clock += 240_000;
        return hang(s.floorId);
      }
      return sheetOf(s.floorId);
    });
    await run();
    clock += 1_000;
    expect(await run()).toEqual({ ok: false, error: "Reading page 4 ran out of time twice" });
    expect(plan()).toMatchObject({ state: "failed", said: "Reading page 4 ran out of time twice" });
    const kept = plan().reading as { partial?: boolean; late?: number; floors: Record<string, unknown[]> };
    expect(kept.partial).toBe(true);
    expect(kept.late).toBeUndefined();
    expect(Object.keys(kept.floors).sort()).toEqual(["p2", "p3"]);
    /* pressed again, it reads the one floor left */
    expect(await readPlanAgain("org-1", "job-1", "jplan_1")).toBe(true);
    readSheet.mockClear();
    readSheet.mockImplementation(async (_o: string, s: { floorId: string }) => sheetOf(s.floorId));
    clock += 1_000;
    expect(await run()).toMatchObject({ ok: true, finished: { jobUuid: "job-1" } });
    expect(readSheet.mock.calls.map((c) => c[1].floorId)).toEqual(["p4"]);
    expect(Object.keys((plan().reading as { floors: Record<string, unknown[]> }).floors).sort()).toEqual(["p2", "p3", "p4"]);
  });
});

describe("the site", () => {
  it("is read off the pages the set titles as site plans, alone", async () => {
    drawn([otherPage(1), { ...otherPage(2), kind: "site" }, floorPage(3, 0, "Ground floor"), floorPage(4, 1, "Level 1"), { ...otherPage(5), kind: "site" }]);
    expect(await run()).toMatchObject({ ok: true });
    expect(readSite.mock.calls[0][4]).toEqual([1, 4]);
  });

  it("is sent no pages of its own when no title names a site plan, so the set is sent as before", async () => {
    threeFloors();
    expect(await run()).toMatchObject({ ok: true });
    expect(readSite.mock.calls[0][4]).toEqual([]);
  });
});

describe("a roof or a site that couldn't be read", () => {
  it("is left unread rather than kept as none, and said on the row, which asks to be checked", async () => {
    threeFloors();
    readSite.mockImplementation(async () => {
      throw new Error("Tiff's answer was too long to finish");
    });
    expect(await run()).toMatchObject({ ok: true, state: "check" });
    const read = plan().reading as Row;
    expect("site" in read).toBe(false);
    expect(read.roof).toBeDefined();
    expect(read.missed).toEqual(["The site couldn't be read: Tiff's answer was too long to finish"]);
    expect(plan()).toMatchObject({ state: "check", said: "The site couldn't be read: Tiff's answer was too long to finish" });
    expect(await rowLine()).toBe("Pages 2, 3 and 4 read: Ground floor, Level 1 and Level 2 and the roof. The site couldn't be read: Tiff's answer was too long to finish. No scale on the plan, so the rooms have no sizes");
  });

  it("is still said after somebody chooses the floors", async () => {
    threeFloors();
    readSite.mockImplementation(async () => {
      throw new Error("Overloaded");
    });
    await run();
    expect(await choosePlanFloors("org-1", "jplan_1", { 4: "none" }, null)).toBeNull();
    expect(plan()).toMatchObject({ state: "check", said: "The site couldn't be read: Overloaded" });
  });

  it("is read again by a run handed on", async () => {
    threeFloors();
    readSheet.mockImplementation(async (_o: string, s: { floorId: string }) => {
      if (s.floorId === "p4") {
        clock += 240_000;
        return hang(s.floorId);
      }
      return sheetOf(s.floorId);
    });
    readSite.mockImplementationOnce(async () => {
      throw new Error("busy");
    });
    await run();
    readSheet.mockImplementation(async (_o: string, s: { floorId: string }) => sheetOf(s.floorId));
    clock += 1_000;
    await run();
    expect(readSite).toHaveBeenCalledTimes(2);
    expect(plan().state).toBe("read");
    expect(plan().said).toBeNull();
  });
});

describe("a run with only the roof and the site left", () => {
  it("gives them till 260 s, so a roof that took four minutes lands", async () => {
    threeFloors();
    const floors = Object.fromEntries(["p2", "p3", "p4"].map((id) => [id, [sheetOf(id)]]));
    plan().reading = { at: "2026-11-22T00:00:00Z", model: "claude-opus-5-5", floors, failed: [], site: null, partial: true };
    readRoof.mockImplementation(() => {
      clock += 250_000;
      return new Promise<Record<string, unknown>>((r) => setTimeout(() => r({ said: null, levels: [], parts: [], raked: [], material: "tiles", roofSpace: "" }), 5));
    });
    expect(await run()).toMatchObject({ ok: true, finished: { jobUuid: "job-1" } });
    expect(readSheet).not.toHaveBeenCalled();
    expect((plan().reading as { roof?: { material: string } }).roof?.material).toBe("tiles");
  });

  it("finishes without a roof that isn't back by 260 s, and says so", async () => {
    threeFloors();
    const floors = Object.fromEntries(["p2", "p3", "p4"].map((id) => [id, [sheetOf(id)]]));
    plan().reading = { at: "2026-11-22T00:00:00Z", model: "claude-opus-5-5", floors, failed: [], site: null, partial: true };
    readRoof.mockImplementation(() => {
      clock += 270_000;
      return new Promise<Record<string, unknown>>(() => {});
    });
    expect(await run()).toMatchObject({ ok: true, state: "check", finished: { jobUuid: "job-1" } });
    expect(plan()).toMatchObject({ state: "check", said: "The roof took too long to read" });
    const read = plan().reading as Row;
    expect("roof" in read).toBe(false);
    expect(read.partial).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await rowLine()).toContain("The roof took too long to read");
  });
});

describe("the roof in slices", () => {
  it("keeps the slice back in time when the other is late, and the run handed on asks only for that one", async () => {
    readSheet.mockImplementationOnce(async (_o: string, sh: { floorId: string }) => {
      clock += 240_000;
      return sheetOf(sh.floorId);
    });
    threeFloors();
    readRoof.mockImplementation(async () => ({ said: null, levels: [{ floorId: "p2", ceilingMm: 2700, floorZoneMm: 0, source: "A301" }], parts: [], raked: [], material: "metal", roofSpace: "" }));
    heightsHeld.on = true;
    expect(await run()).toMatchObject({ ok: true, state: "reading" });
    const first = plan().reading as Row;
    expect(first.roofSlices).toEqual({ shape: { parts: [], material: "metal" } });
    expect("roof" in first).toBe(false);
    heightsHeld.on = false;
    expect(await run()).toMatchObject({ ok: true, finished: { jobUuid: "job-1" } });
    expect(slicesAsked).toEqual([
      { shape: true, heights: true },
      { shape: false, heights: true },
    ]);
    const read = plan().reading as Row;
    expect(read.roofSlices).toBeUndefined();
    expect(read.roof).toMatchObject({ material: "metal", levels: [{ floorId: "p2", ceilingMm: 2700 }] });
  });

  it("joins the roof without a slice still late on a run of its own, and says which", async () => {
    threeFloors();
    const floors = Object.fromEntries(["p2", "p3", "p4"].map((id) => [id, [sheetOf(id)]]));
    plan().reading = { at: "2026-11-22T00:00:00Z", model: "claude-opus-5-5", floors, failed: [], site: null, partial: true };
    readRoof.mockImplementation(async () => {
      clock += 270_000;
      return { said: null, levels: [], parts: [], raked: [], material: "tiles", roofSpace: "" };
    });
    heightsHeld.on = true;
    expect(await run()).toMatchObject({ ok: true, state: "check", finished: { jobUuid: "job-1" } });
    expect(plan()).toMatchObject({ said: "The roof's heights took too long to read" });
    expect((plan().reading as Row).roof).toMatchObject({ material: "tiles", levels: [] });
  });

  it("sends its shape the roof plans and its heights the pages that print most levels, and reads those levels", () => {
    const at = (text: string, x: number, y: number) => ({ text, x, y, w: 20 });
    const texts = [
      { n: 1, words: [at("40°", 10, 10), at("40°", 50, 10), at("20°", 90, 10)] },
      { n: 2, words: [at("ROOF PLAN", 10, 10)] },
      { n: 3, words: [at("GF FFL", 100, 400), at("RL 194000 mm", 100, 407.8), at("GF FCL", 100, 300), at("RL 197200 mm", 100, 307.8)] },
      { n: 4, words: [at("NORTH ELEVATION", 10, 10)] },
      { n: 6, words: [at("NOTES", 10, 10)] },
    ];
    const pages = [otherPage(1), { ...otherPage(2), kind: "roof" }, otherPage(3), { ...otherPage(4), kind: "elevation" }, floorPage(5, 0, "Ground floor"), otherPage(6)] as Parameters<typeof roofPagesOf>[1];
    expect(roofPagesOf(texts, pages)).toEqual({ shape: [1, 0], heights: [2, 3], printed: { floors: [{ level: 0, ffl: 194, fcl: 197.2, pages: [3] }], ridges: [] } });
  });
});

describe("the roof's and the site's first page", () => {
  it("is the set's first floor plan page, in a set drawn from the top down", async () => {
    drawn([otherPage(1), floorPage(2, 1, "Level 1"), floorPage(3, 0, "Ground floor")]);
    await run();
    expect(readRoof.mock.calls[0]![4]).toBe(1);
    expect(readSite.mock.calls[0]![3]).toBe(1);
  });
});

describe("each floor put on the drawing's walls", () => {
  it("opens the file one floor at a time", async () => {
    threeFloors();
    await run();
    expect(vectorsInNode).toHaveBeenCalledTimes(3);
    expect(opening.most).toBe(1);
  });

  it("goes by the scale its dimensions gave it in the same read", async () => {
    /* 3000 mm over 300 px: 10 mm a pixel; the file's 2 pixels a point make 20 mm a point, so a side moves at most 450 / 20 points */
    readDimensions.mockImplementation(async () => [{ a: { x: 0, y: 0 }, b: { x: 300, y: 0 }, mm: 3000 }]);
    drawn([otherPage(1), floorPage(2, 0, "Ground floor")]);
    await run();
    expect(snapped).toHaveBeenCalledTimes(1);
    expect(snapped.mock.calls[0]![3]).toBeCloseTo(22.5);
  });

  it("leaves the rooms where the read put them on a floor with no scale, rather than at a guessed 1:100", async () => {
    drawn([otherPage(1), floorPage(2, 0, "Ground floor")]);
    await run();
    expect(vectorsInNode).toHaveBeenCalledTimes(1);
    expect(snapped).not.toHaveBeenCalled();
  });
});

describe("the schedule's marks on a floor that prints no scale", () => {
  const withSchedule = (mark: { x: number; y: number }) =>
    drawn([otherPage(1), floorPage(2, 0, "Ground floor", { words: [{ text: "GD.10", at: mark }] }), ...[3, 4, 5, 6, 7, 8].map(otherPage), otherPage(9)]);
  const theDoor = () => (plan().reading as { floors: Record<string, { openings: { tag: string; widthMm: number }[] }[]> }).floors.p2[0].openings[0];

  it("are found by the scale its dimensions give it in the same read", async () => {
    /* 3000 mm over 300 px: 10 mm a pixel, so a mark 80 px off the door is 800 mm off it */
    readDimensions.mockImplementation(async () => [{ a: { x: 0, y: 0 }, b: { x: 300, y: 0 }, mm: 3000 }]);
    withSchedule({ x: 130, y: 100 });
    await run();
    expect(theDoor()).toMatchObject({ tag: "GD.10", widthMm: 820 });
  });

  it("aren't put on its doors by a scale guessed for it", async () => {
    /* no dimensions read: how far 20 px is can't be told */
    withSchedule({ x: 70, y: 100 });
    await run();
    expect(theDoor()).toMatchObject({ tag: "", widthMm: 900 });
  });

  it("are found by the scale its rooms' written sizes give it, as the Studio takes it", async () => {
    /* each room 100 px a side, written 1 m by 1 m: 10 mm a pixel */
    readSheet.mockImplementation(async (_o: string, s: { floorId: string }) => ({ ...sheetOf(s.floorId), spaces: [{ ...room("Living", 0), written: "1.0m x 1.0m" }, { ...room("Kitchen", 100), written: "1.0m x 1.0m" }] }));
    withSchedule({ x: 130, y: 100 });
    await run();
    expect(theDoor()).toMatchObject({ tag: "GD.10", widthMm: 820 });
  });

  it("not read in time is said for the floors read without it, and kept on the reading", async () => {
    readDimensions.mockImplementation(async () => [{ a: { x: 0, y: 0 }, b: { x: 300, y: 0 }, mm: 3000 }]);
    readSheet.mockImplementation(async (_o: string, s: { floorId: string }) => {
      clock += 240_000;
      return sheetOf(s.floorId);
    });
    readSchedule.mockImplementation(() => new Promise<never>(() => {}));
    withSchedule({ x: 130, y: 100 });
    expect(await run()).toMatchObject({ ok: true, state: "check" });
    const said = "The door and window schedule on page 9 wasn't read in time, so the openings on page 2 aren't sized by it";
    expect(plan()).toMatchObject({ state: "check", said });
    expect((plan().reading as Row).missed).toEqual([said]);
    expect(theDoor()).toMatchObject({ tag: "", widthMm: 900 });
  });

  it("not looked for in time says so, rather than that the set has one", async () => {
    readSheet.mockImplementation(async (_o: string, s: { floorId: string }) => {
      clock += 240_000;
      return sheetOf(s.floorId);
    });
    textsInNode.mockImplementationOnce(() => new Promise<never>(() => {}));
    withSchedule({ x: 130, y: 100 });
    await run();
    expect(plan().said).toBe("The set wasn't looked through for a door and window schedule in time, so the openings on page 2 aren't sized by it");
  });
});

describe("a page's dimensions not back in time", () => {
  it("keeps the pages that came back, and leaves the rest unmeasured for the quote's rooms to look for again", async () => {
    drawn([otherPage(1), floorPage(2, 0, "Ground floor"), floorPage(3, 1, "Level 1")]);
    readSheet.mockImplementation(async (_o: string, s: { floorId: string }) => {
      if (s.floorId === "p2") clock += 240_000;
      return sheetOf(s.floorId);
    });
    readDimensions.mockImplementation(async (_o: unknown, s: unknown) => ((s as { floorId: string }).floorId === "p3" ? new Promise<never>(() => {}) : [{ a: { x: 0, y: 0 }, b: { x: 300, y: 0 }, mm: 3000 }]));
    await run();
    const pages = plan().pages as { n: number; measured?: { mmPerPx: number } | null }[];
    expect(pages.find((p) => p.n === 2)!.measured?.mmPerPx).toBeCloseTo(10);
    expect("measured" in pages.find((p) => p.n === 3)!).toBe(false);
    expect(await rowLine()).toContain("No scale on page 3, so its rooms have no sizes");
  });
});

describe("which pages are floors, when Tiff couldn't look", () => {
  it("fails the read, saying which pages weren't looked at, rather than reading the floors the words named", async () => {
    look.mockImplementationOnce(async () => {
      throw new Error("Overloaded");
    });
    expect(await run()).toEqual({ ok: false, error: "Tiff couldn't look at page 1 to see which are floor plans" });
    expect(plan()).toMatchObject({ state: "failed", pages: [] });
  });

  it("says a set with no floor plan found had pages she didn't get to, not that it has none", async () => {
    titles.now = ["A101", "A102"];
    look.mockImplementationOnce(async () => ({ content: [{ type: "text", text: JSON.stringify({ pages: [{ page: 1, kind: "other", level_name: "", level: 0 }] }) }] }));
    expect(await run()).toEqual({ ok: false, error: "No floor plan was found, and Tiff didn't get to look at page 2" });
  });
});

describe("which pages are floors, in a set bigger than one look", () => {
  it("looks at every page its words leave undecided, so a ground floor near the end of the set is read", async () => {
    /* 27 sheets drawn from the top down: level 1 named by its words, the ground floor on page 26 not */
    titles.now = ["LEVEL 1 PLAN", ...Array.from({ length: 26 }, (_, i) => `A${102 + i}`)];
    const answer = async (o: Look) => ({
      content: [{ type: "text", text: JSON.stringify({ pages: shownIn(o).map((page) => (page === 26 ? { page, kind: "floor", level_name: "Ground floor", level: 0 } : { page, kind: "other", level_name: "", level: 0 })) }) }],
    });
    look.mockImplementationOnce(answer).mockImplementationOnce(answer);
    expect(await runAll()).toMatchObject({ ok: true, finished: { jobUuid: "job-1" } });
    expect(look).toHaveBeenCalledTimes(2);
    expect(shownIn(look.mock.calls[0]![0])).toHaveLength(24);
    expect(shownIn(look.mock.calls[1]![0])).toEqual([26, 27]);
    expect(readSheet.mock.calls.map((c) => c[1].floorId).sort()).toEqual(["p1", "p26"]);
    expect((plan().pages as { n: number; kind: string }[]).find((p) => p.n === 26)!.kind).toBe("floor");
  });

  it("reads the floors found, and says the pages Tiff's answer left out, asking to be checked", async () => {
    titles.now = ["GF PLAN", "A101", "A102"];
    look.mockImplementationOnce(async () => ({ content: [{ type: "text", text: JSON.stringify({ pages: [{ page: 2, kind: "other", level_name: "", level: 0 }] }) }] }));
    expect(await runAll()).toMatchObject({ ok: true, state: "check" });
    expect(plan().said).toBe("Tiff didn't get to look at page 3, which may be a floor plan");
    expect(await rowLine()).toContain("Tiff didn't get to look at page 3, which may be a floor plan");
  });

  it("takes no answer for a page its look wasn't shown", async () => {
    /* page 1 is a garage's ground floor plan, which its words say isn't the house's */
    titles.now = ["GARAGE GROUND FLOOR PLAN", "A101"];
    look.mockImplementationOnce(async () => ({ content: [{ type: "text", text: JSON.stringify({ pages: [{ page: 1, kind: "floor", level_name: "Ground floor", level: 0 }, { page: 2, kind: "floor", level_name: "Level 1", level: 1 }] }) }] }));
    await runAll();
    expect((plan().pages as { n: number; kind: string }[]).map((p) => p.kind)).toEqual(["other", "floor"]);
  });
});

describe("handing the read on to the next run", () => {
  it("fails the plan when the route turns it away", async () => {
    fetchMock.mockImplementation(async () => new Response("", { status: 500 }));
    expect(await run()).toEqual({ ok: false, error: "The read couldn't be handed on" });
    expect(plan()).toMatchObject({ state: "failed", said: "The read couldn't be handed on" });
  });

  it("fails the plan when the route can't be reached", async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await run()).toEqual({ ok: false, error: "The read couldn't be handed on" });
  });

  it("fails the plan when its claim can't be let go, and doesn't ask the route", async () => {
    refuse.update = (table, patch) => (table === "job_plans" && "claimed_at" in patch && patch.claimed_at === null ? { code: "08006", message: "connection failure" } : null);
    expect(await run()).toEqual({ ok: false, error: "The read couldn't be handed on" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the claim on a read", () => {
  it("reads nothing when the claim fails", async () => {
    refuse.update = (table, patch) => (table === "job_plans" && typeof patch.claimed_at === "string" ? { code: "57014", message: "canceling statement due to statement timeout" } : null);
    expect(await run()).toEqual({ ok: true, state: "reading" });
    expect(previewsInNode).not.toHaveBeenCalled();
  });

  it("reads as before in a workspace whose plans have no claim yet", async () => {
    refuse.update = (table, patch) => (table === "job_plans" && typeof patch.claimed_at === "string" ? { code: "42703", message: 'column "claimed_at" does not exist' } : null);
    await run();
    expect(previewsInNode).toHaveBeenCalledTimes(1);
  });
});

describe("the same file into Plans by two doors at once", () => {
  it("counts the one the other door put in as there, and adds the rest", async () => {
    tables.job_plans = [];
    refuse.insert = (_t, row) => (row.document_id === "d-1" ? { code: "23505", message: 'duplicate key value violates unique constraint "job_plans_document"' } : null);
    const out = await addJobPlans("org-1", "job-1", [{ documentId: "d-1" }, { documentId: "d-2" }], null);
    expect(out).toMatchObject({ ok: true, already: 1 });
    expect(out.ok && out.planIds).toHaveLength(1);
    expect(tables.job_plans!.map((r) => r.document_id)).toEqual(["d-2"]);
  });
});

describe("the rooms for a quote (jobPlanRooms)", () => {
  it("has the read route read a plan it adds, rather than reading it in the quote's turn", async () => {
    tables.job_plans = [];
    fetchMock.mockImplementation(async (_url: unknown, init: unknown) => {
      const { planId } = JSON.parse(String((init as { body: string }).body)) as { planId: string };
      Object.assign(tables.job_plans!.find((r) => r.id === planId)!, { state: "read", pages: [], reading: { at: "", model: "", floors: {}, failed: [] } });
      return new Response("{}");
    });
    const out = await jobPlanRooms("org-1", "job-1", { add: { documentId: "d-1" }, origin: "https://app.test" });
    expect(typeof out).toBe("object");
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://app.test/api/jobs/plans/read");
    expect(previewsInNode).not.toHaveBeenCalled();
    expect(readSheet).not.toHaveBeenCalled();
  });

  it("fails and says a plan the route turns away, without waiting on it", async () => {
    tables.job_plans = [];
    fetchMock.mockImplementation(async () => new Response("", { status: 500 }));
    const timers = jest.spyOn(global, "setTimeout");
    const out = await jobPlanRooms("org-1", "job-1", { add: { documentId: "d-1" }, origin: "https://app.test" });
    /* the route asked once, with four seconds to take it, and the row not watched after */
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(timers.mock.calls.map((c) => c[1])).toEqual([4_000]);
    expect(plan()).toMatchObject({ state: "failed", said: "The read couldn't be started" });
    expect(out).toMatchObject({ plans: [{ state: "failed", said: "The read couldn't be started" }] });
    expect(typeof out === "object" && out.said).toContain("A plan that couldn't be read is said so");
    expect(typeof out === "object" && out.said).not.toContain("still being read");
  });

  it("leaves a plan another run holds the claim on to that run, when the route can't be reached", async () => {
    Object.assign(plan(), { added_at: new Date(clock - 7 * 60_000).toISOString(), claimed_at: new Date(clock - 60_000).toISOString() });
    fetchMock.mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });
    await jobPlanRooms("org-1", "job-1", { origin: "https://app.test" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(plan().state).toBe("reading");
  });

  const readPlanWithUnscaledFloor = () =>
    Object.assign(plan(), {
      state: "read",
      pages: [floorPage(2, 0, "Ground floor")],
      page_count: 1,
      reading: { at: "2026-11-22T00:00:00Z", model: "claude-opus-5-5", floors: { p2: [sheetOf("p2")] }, failed: [] },
    });

  it("keeps a scale set on the plan while Tiff looked for its dimensions", async () => {
    readPlanWithUnscaledFloor();
    readDimensions.mockImplementation(async () => {
      /* Set scale, saved in the meantime */
      const pages = plan().pages as Row[];
      plan().pages = pages.map((p) => ({ ...p, set: { mmPerPx: 12, mm: 3600, by: "Sam", at: "2026-11-22T00:00:00Z" } }));
      return [{ a: { x: 0, y: 0 }, b: { x: 300, y: 0 }, mm: 3000 }];
    });
    await jobPlanRooms("org-1", "job-1");
    expect((plan().pages as Row[])[0]).toMatchObject({ set: { mmPerPx: 12 } });
  });

  it("looks for a page's dimensions once, even when the look fails", async () => {
    readPlanWithUnscaledFloor();
    readDimensions.mockImplementation(async () => {
      throw new Error("Overloaded");
    });
    await jobPlanRooms("org-1", "job-1");
    expect((plan().pages as Row[])[0]!.measured).toBeNull();
    await jobPlanRooms("org-1", "job-1");
    expect(readDimensions).toHaveBeenCalledTimes(1);
  });
});

describe("a plan stuck on reading, asked for again by the job's screen", () => {
  const MIN = 60_000;
  const at = Date.parse("2026-11-22T10:00:00Z");
  const reading = (id: string, addedMinsAgo: number) => ({ id, state: "reading", addedAt: new Date(at - addedMinsAgo * MIN).toISOString() });

  it("is asked for once it has been reading past a read's time", () => {
    expect(plansToAskAgain([reading("a", 2), reading("b", 7), { ...reading("c", 30), state: "read" }], new Map(), at)).toEqual(["b"]);
  });

  it("is asked for again once a claim's length has gone by, not before", () => {
    expect(plansToAskAgain([reading("b", 30)], new Map([["b", at - 3 * MIN]]), at)).toEqual([]);
    expect(plansToAskAgain([reading("b", 30)], new Map([["b", at - 11 * MIN]]), at)).toEqual(["b"]);
  });
});
