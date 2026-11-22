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
    let update: Row | null = null;
    let insert: Row | null = null;
    const rows = () => (tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push([c, v]), q),
      neq: () => q,
      or: () => q,
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
const fullInNode = jest.fn(async (_b: Uint8Array, ns: readonly number[]) => ns.map((n) => ({ n, png: Buffer.from("png"), width: 2400, height: 1695, words: [{ text: "DOOR SCHEDULE", at: { x: 10, y: 10 } }] })));
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

const room = (name: string, x: number) => ({ name, named: true, kind: "room", outline: [{ x, y: 0 }, { x: x + 100, y: 0 }, { x: x + 100, y: 100 }, { x, y: 100 }], written: "", existing: false, openTo: "", stair: "" });
const door = { kind: "door", tag: "", a: { x: 0, y: 100 }, b: { x: 100, y: 100 }, widthMm: 900, room: "Living", external: false, facing: "" };
const sheetOf = (floorId: string) => ({ sheetId: floorId, spaces: [room("Living", 0), room("Kitchen", 100)], openings: [{ ...door }] });
const readSheet = jest.fn(async (_o: string, s: { floorId: string }) => sheetOf(s.floorId));
/* a floor's read that isn't back till the test is over */
const hung: (() => void)[] = [];
const hang = (floorId: string) => new Promise<ReturnType<typeof sheetOf>>((r) => hung.push(() => r(sheetOf(floorId))));
const readRoof = jest.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ said: null, levels: [], parts: [], raked: [], material: "", roofSpace: "" }));
const readSite = jest.fn(async (..._a: unknown[]): Promise<unknown> => null);
const readDimensions = jest.fn(async (..._a: unknown[]): Promise<unknown[]> => []);
const readSchedule = jest.fn(async () => ({ items: [{ mark: "GD.10", type: "", kind: "door", width_mm: 820, height_mm: 2040, sill_mm: 0 }] }));
jest.mock("@/lib/studio/reading-server", () => ({
  READING_MODEL: "claude-opus-5-5",
  readSheet: (...a: unknown[]) => readSheet(...(a as [string, { floorId: string }])),
  readRoof: (...a: unknown[]) => readRoof(...a),
  readSite: (...a: unknown[]) => readSite(...a),
  readDimensions: (...a: unknown[]) => readDimensions(...a),
  readSchedule: () => readSchedule(),
  askWith: async () => ({}),
  pngBlock: (b: Buffer) => b,
}));

/* the read route, asked by the server: answered as a test says */
const fetchMock = jest.fn(async (..._a: unknown[]): Promise<Response> => new Response("{}"));
global.fetch = fetchMock as unknown as typeof fetch;

import { addJobPlans, jobPlanRooms, readPlan, readPlanAgain } from "../plans-server";
import { plansToAskAgain } from "../plans-client";

/* Tiff's look at the pages the words leave undecided: each said to be "other", unless a test says otherwise */
const look = jest.fn(async (o: { messages: { content: { type: string; text?: string }[] }[] }) => {
  const pages = o.messages[0].content.flatMap((b) => (b.type === "text" && /^Page \d+:$/.test(b.text ?? "") ? [Number(b.text!.slice(5, -1))] : []));
  return { content: [{ type: "text", text: JSON.stringify({ pages: pages.map((page) => ({ page, kind: "other", level_name: "", level: 0 })) }) }] };
});
const client = { beta: { messages: { create: (o: never) => look(o) } } } as never;
const plan = () => tables.job_plans![0]!;
const run = () => readPlan("org-1", "jplan_1", "https://app.test", client);

/* a set drawn already, its floors found and drawn in full: the next run is the read */
const floorPage = (n: number, level: number, name: string, extra: Row = {}) => ({ n, kind: "floor", name, level, ref: `org/org-1/p${n}.png`, preview: null, width: 2400, height: 1695, mmPerPx: null, scale: null, walled: { none: "Its walls aren't drawn in the file, filled or in lines" }, ...extra });
const otherPage = (n: number) => ({ n, kind: "other", name: "", level: null, ref: null, preview: null, width: 2400, height: 1695, mmPerPx: null, scale: null });
const drawn = (pages: Row[], more: Row = {}) => Object.assign(plan(), { pages, page_count: pages.length, ...more });
const threeFloors = () => drawn([otherPage(1), floorPage(2, 0, "Ground floor"), floorPage(3, 1, "Level 1"), floorPage(4, 2, "Level 2")]);

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  clock = 1_000_000;
  jest.spyOn(Date, "now").mockImplementation(() => clock);
  for (const f of [previewsInNode, fullInNode, vectorsInNode, textsInNode, readSheet, readRoof, readSite, readDimensions, readSchedule, fetchMock, look]) f.mockClear();
  readSheet.mockImplementation(async (_o: string, s: { floorId: string }) => sheetOf(s.floorId));
  readSite.mockImplementation(async () => null);
  readRoof.mockImplementation(async () => ({ said: null, levels: [], parts: [], raked: [], material: "", roofSpace: "" }));
  readDimensions.mockImplementation(async () => []);
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
    expect(await run()).toEqual({ ok: true, state: "reading" });
    const kept = plan().reading as { partial?: boolean; late?: number; floors: Record<string, unknown[]>; failed: unknown[] };
    expect(kept.partial).toBe(true);
    expect(kept.late).toBe(1);
    expect(Object.keys(kept.floors).sort()).toEqual(["p2", "p3"]);
    expect(kept.failed).toEqual([]);
    expect(plan().state).toBe("reading");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    /* the next run reads only the floor that didn't come back */
    readSheet.mockClear();
    readSheet.mockImplementation(async (_o: string, s: { floorId: string }) => sheetOf(s.floorId));
    clock += 1_000;
    const out = await run();
    expect(out).toMatchObject({ ok: true, finished: { jobUuid: "job-1" } });
    expect(readSheet.mock.calls.map((c) => c[1].floorId)).toEqual(["p4"]);
    const read = plan().reading as { partial?: boolean; late?: number; floors: Record<string, unknown[]> };
    expect(read.partial).toBeUndefined();
    expect(read.late).toBeUndefined();
    expect(Object.keys(read.floors).sort()).toEqual(["p2", "p3", "p4"]);
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

describe("a roof or a site that couldn't be read", () => {
  it("is left unread rather than kept as none, and said on the row", async () => {
    threeFloors();
    readSite.mockImplementation(async () => {
      throw new Error("Tiff's answer was too long to finish");
    });
    expect(await run()).toMatchObject({ ok: true, state: "read" });
    const read = plan().reading as Row;
    expect("site" in read).toBe(false);
    expect(read.roof).toBeDefined();
    expect(plan().said).toBe("The site couldn't be read: Tiff's answer was too long to finish");
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
