/**
 * @jest-environment node
 *
 * Reading scanned pages with vision — the decisions, not the call.
 *
 * TWO THINGS CAN PUT TEXT ON THE WRONG PAGE, and both are here. The model
 * answers a SLICED pdf numbered 1..n, so entry i means `pages[i]` of the real
 * manual — a short answer must pad, never shift. And a chunk stamps itself with
 * its first and last page, so pages that aren't adjacent must never share one,
 * or a citation claims a range nobody read.
 *
 * Nothing here calls the API or opens a PDF. (House rule: no test mocks the
 * Anthropic SDK; the lib is what gets mocked, one level up.)
 */

/* `ocr-run` is the IO half, so importing it for its two pure exports drags in
   a Supabase client that constructs itself at module scope. Stubbed rather
   than configured — nothing here reaches the database. */
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  contiguousRuns,
  planOcrGroups,
  seatRecovered,
  shapePageTexts,
  slicePdf,
  OCR_PAGE_BATCH,
} from "../ocr";
import { chunkRecovered, planOcrRun, type OcrDocState } from "../ocr-run";

const run = promisify(execFile);
const RUNNER = path.join(__dirname, "fixtures", "extract-runner.mjs");
const FIXTURE = path.join(__dirname, "fixtures", "sample.pdf");
const SPECIFIER = "pdfjs-dist/legacy/build/pdf.mjs";

/* THE GATE for the other half of this feature. Sending a 385-page manual to
   recover three pages is the thing slicing exists to avoid, so "pdf-lib
   produces a real PDF holding exactly the pages asked for, in order" is the
   claim everything downstream rests on — and the only honest proof is opening
   the result with the same reader ingestion uses. Cheap to run: the fixture is
   three pages, and page 3 is the textless stand-in for a scanned one. */
describe("slicing pages out of a PDF", () => {
  it("produces a readable PDF of exactly the pages asked for, in order", async () => {
    const source = new Uint8Array(await fs.readFile(FIXTURE));
    const sliced = await slicePdf(source, [3, 1]);

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kb-ocr-"));
    const out = path.join(dir, "slice.pdf");
    try {
      await fs.writeFile(out, sliced);
      const { stdout } = await run(process.execPath, [RUNNER, SPECIFIER, out], {
        timeout: 20_000,
      });
      const read = JSON.parse(stdout) as { pages: number; texts: string[] };

      expect(read.pages).toBe(2);
      // asked for 3 then 1, so the textless page leads and page 1 follows
      expect(read.texts[0]).toBe("");
      expect(read.texts[1]).toContain("PUZ-ZM250");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("shaping — alignment", () => {
  it("keeps a well-formed answer as it is", () => {
    expect(shapePageTexts({ pages: ["one", "two"] }, 2)).toEqual(["one", "two"]);
  });

  /* The whole point. Two pages of text for three pages asked about must leave
     the THIRD empty — shifting up would file page 3's gap under page 2 and
     hand every later citation the wrong page. */
  it("pads a short answer rather than shifting entries up", () => {
    expect(shapePageTexts({ pages: ["one"] }, 3)).toEqual(["one", "", ""]);
  });

  it("drops the tail of a long answer", () => {
    expect(shapePageTexts({ pages: ["a", "b", "c"] }, 2)).toEqual(["a", "b"]);
  });

  it("turns an entry that isn't a string into an empty one, in place", () => {
    expect(shapePageTexts({ pages: ["a", 42, null, "d"] }, 4)).toEqual(["a", "", "", "d"]);
  });

  it("trims, so a page of whitespace reads as nothing found", () => {
    expect(shapePageTexts({ pages: ["  text  ", "   "] }, 2)).toEqual(["text", ""]);
  });

  it("survives an answer with no pages field, or no object at all", () => {
    for (const junk of [{}, { pages: "text" }, null, undefined, 7, [], "text"]) {
      expect(shapePageTexts(junk, 2)).toEqual(["", ""]);
    }
  });

  it("returns nothing when nothing was asked for", () => {
    expect(shapePageTexts({ pages: ["a"] }, 0)).toEqual([]);
  });
});

describe("grouping pages into requests", () => {
  it("cuts the list into batches, keeping order", () => {
    expect(planOcrGroups([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("keeps the real page numbers, however scattered", () => {
    expect(planOcrGroups([7, 23, 44], 2)).toEqual([[7, 23], [44]]);
  });

  it("answers an empty list with no groups", () => {
    expect(planOcrGroups([], OCR_PAGE_BATCH)).toEqual([]);
  });

  /* A nonsense size is a caller's bug; one page per request is the honest
     reading of it, and never a zero-length group that would loop forever. */
  it("treats a nonsense size as one page a request", () => {
    for (const size of [0, -2, Number.NaN]) {
      expect(planOcrGroups([1, 2], size)).toEqual([[1], [2]]);
    }
  });
});

describe("seating what came back", () => {
  const long = "Set the dip switch to ON before powering the outdoor unit up.";

  it("puts each answer on the page it was asked about", () => {
    const pages = seatRecovered(
      [[7, 23], [44]],
      [
        { ok: true, texts: [long, `${long} Second.`] },
        { ok: true, texts: [`${long} Third.`] },
      ]
    );
    expect(pages.map((p) => p.page)).toEqual([7, 23, 44]);
    expect(pages[0].text).toBe(long);
  });

  /* The floor, and the reason it exists. Against the real library most
     "unreadable" pages are a full-bleed photo with a page number on it — "02"
     stored as a chunk is a searchable page with no answer on it. */
  it("drops a page whose recovered text still wouldn't clear the floor", () => {
    const pages = seatRecovered([[2, 5]], [{ ok: true, texts: ["02", long] }]);
    expect(pages).toEqual([{ page: 5, text: long }]);
  });

  it("drops a page that came back with nothing at all", () => {
    expect(seatRecovered([[15]], [{ ok: true, texts: [""] }])).toEqual([]);
  });

  /* A failed group costs its own pages, never the ones either side of it —
     and never shifts them onto the wrong page numbers. */
  it("skips a failed group and keeps the rest seated correctly", () => {
    const pages = seatRecovered(
      [[1], [2], [3]],
      [
        { ok: true, texts: [long] },
        { ok: false, error: "nope" },
        { ok: true, texts: [`${long} Third.`] },
      ]
    );
    expect(pages.map((p) => p.page)).toEqual([1, 3]);
  });

  it("survives a group whose answer is shorter than the pages asked for", () => {
    expect(seatRecovered([[1, 2]], [{ ok: true, texts: [long] }])).toEqual([
      { page: 1, text: long },
    ]);
  });
});

describe("contiguous runs", () => {
  it("keeps a consecutive stretch together", () => {
    const pages = [
      { page: 40, text: "a" },
      { page: 41, text: "b" },
      { page: 42, text: "c" },
    ];
    expect(contiguousRuns(pages)).toEqual([pages]);
  });

  it("splits at every gap", () => {
    const runs = contiguousRuns([
      { page: 7, text: "a" },
      { page: 23, text: "b" },
      { page: 24, text: "c" },
      { page: 44, text: "d" },
    ]);
    expect(runs.map((r) => r.map((p) => p.page))).toEqual([[7], [23, 24], [44]]);
  });

  it("sorts before it splits, so arrival order can't invent a gap", () => {
    const runs = contiguousRuns([
      { page: 42, text: "c" },
      { page: 40, text: "a" },
      { page: 41, text: "b" },
    ]);
    expect(runs.map((r) => r.map((p) => p.page))).toEqual([[40, 41, 42]]);
  });

  it("answers an empty list with no runs", () => {
    expect(contiguousRuns([])).toEqual([]);
  });
});

describe("chunking what came back", () => {
  /* THE CITATION RULE, pinned. Two short pages far apart would otherwise fit
     one chunk together and stamp it "p.7–44" — a range covering thirty-seven
     pages nobody read. */
  it("never lets one chunk span pages that aren't adjacent", () => {
    const chunks = chunkRecovered([
      { page: 7, text: "Set the dip switch to ON." },
      { page: 44, text: "Torque the flare nut to 55 Nm." },
    ]);

    expect(chunks).toHaveLength(2);
    expect(chunks.map((c) => [c.pageFrom, c.pageTo])).toEqual([
      [7, 7],
      [44, 44],
    ]);
  });

  it("still lets a scanned appendix flow through its own pages", () => {
    const chunks = chunkRecovered([
      { page: 40, text: "Wiring for the outdoor unit." },
      { page: 41, text: "Continued from the previous page." },
    ]);

    expect(chunks).toHaveLength(1);
    expect([chunks[0].pageFrom, chunks[0].pageTo]).toEqual([40, 41]);
  });

  it("has nothing to chunk when nothing was recovered", () => {
    expect(chunkRecovered([])).toEqual([]);
  });
});

describe("what a press is allowed to do", () => {
  const doc = (over: Partial<OcrDocState> = {}): OcrDocState => ({
    status: "ready",
    scannedPages: 3,
    chunkCount: 10,
    storageRef: "orgs/org-1/doc.pdf",
    ...over,
  });
  const rich = { pagesRemaining: 1000, resetsOn: "2026-09-01" };

  it("reads up to the cap when there is allowance", () => {
    expect(planOcrRun(doc(), rich, 40)).toEqual({ kind: "read", allowance: 40 });
  });

  /* A trial org with seven pages left gets seven pages, not a refusal — the
     same courtesy the ingest planner extends. */
  it("shortens the run to what's left rather than refusing it", () => {
    expect(planOcrRun(doc(), { pagesRemaining: 7, resetsOn: "2026-09-01" }, 40)).toEqual({
      kind: "read",
      allowance: 7,
    });
  });

  it("pauses with the reset day when the month is spent", () => {
    expect(planOcrRun(doc(), { pagesRemaining: 0, resetsOn: "2026-09-01" })).toEqual({
      kind: "paused",
      resetsOn: "2026-09-01",
    });
  });

  it("has nothing to do when no page is unreadable", () => {
    expect(planOcrRun(doc({ scannedPages: 0 }), rich)).toEqual({ kind: "done" });
  });

  /* Mid-ingestion the scanned count is still moving and the bookmark belongs
     to another loop — two writers on one row is the bug this prevents. */
  it("refuses a document that is still being read", () => {
    for (const status of ["processing", "paused", "failed", "uploading"]) {
      expect(planOcrRun(doc({ status }), rich)).toMatchObject({ kind: "refused" });
    }
  });

  it("refuses a document with no file", () => {
    expect(planOcrRun(doc({ storageRef: null }), rich)).toMatchObject({ kind: "refused" });
  });

  /* Order matters: a spent allowance must not mask a document that shouldn't
     be here at all, and "done" must beat "paused" so a document with nothing
     to read never reports as blocked. */
  it("checks the document before the allowance", () => {
    const broke = { pagesRemaining: 0, resetsOn: "2026-09-01" };
    expect(planOcrRun(doc({ status: "processing" }), broke)).toMatchObject({ kind: "refused" });
    expect(planOcrRun(doc({ scannedPages: 0 }), broke)).toEqual({ kind: "done" });
  });
});
