/**
 * @jest-environment node
 *
 * Extraction: the gate test that pdfjs works at all in Node, and the pure
 * arithmetic around it.
 *
 * THE GATE. pdfjs-dist/legacy must extract per-page text server-side. Jest
 * itself cannot load pdfjs's ESM (.mjs is hard-ESM to jest — no transform
 * carve-out helps), so the proof runs in a child Node process via
 * fixtures/extract-runner.mjs — the same native-ESM import the Next runtime
 * uses (`serverExternalPackages: ["pdfjs-dist"]`). If this test fails,
 * `openPdf` is broken and nothing downstream of it matters.
 *
 * The fixture has two pages with a text layer and one deliberately textless
 * page — the stand-in for a scanned page, which ingestion must detect rather
 * than silently index as empty.
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { isScannedPage, MIN_TEXT_CHARS, PAGE_BATCH, pageWindow } from "../extract";

const run = promisify(execFile);
const RUNNER = path.join(__dirname, "fixtures", "extract-runner.mjs");
const FIXTURE = path.join(__dirname, "fixtures", "sample.pdf");
const SPECIFIER = "pdfjs-dist/legacy/build/pdf.mjs"; // exactly what extract.ts imports

test("pdfjs legacy build extracts per-page text in a plain Node process", async () => {
  const { stdout } = await run(process.execPath, [RUNNER, SPECIFIER, FIXTURE], {
    timeout: 20_000,
  });
  const out = JSON.parse(stdout) as { pages: number; texts: string[] };

  expect(out.pages).toBe(3);
  expect(out.texts[0]).toContain("PUZ-ZM250");
  expect(out.texts[1]).toContain("500 microns");
  expect(out.texts[2]).toBe(""); // the "scanned" page
}, 30_000);

/* A page with no text layer and a page carrying only a running header are the
   same thing to getTextContent — near-nothing. Both are counted as scanned and
   surfaced honestly, because the alternative is a library that claims to cover
   a manual it can't read a word of. */
describe("scanned-page detection", () => {
  it("calls an empty page scanned", () => {
    expect(isScannedPage("")).toBe(true);
    expect(isScannedPage("   \n ")).toBe(true);
  });

  it("calls a page with only furniture on it scanned", () => {
    expect(isScannedPage("CITY MULTI  •  page 42")).toBe(true);
  });

  it("lets a real sentence through", () => {
    expect(isScannedPage("Evacuate the system to below 500 microns before charging.")).toBe(false);
  });

  it("sits the threshold exactly on MIN_TEXT_CHARS", () => {
    expect(isScannedPage("x".repeat(MIN_TEXT_CHARS - 1))).toBe(true);
    expect(isScannedPage("x".repeat(MIN_TEXT_CHARS))).toBe(false);
    // leading and trailing space is not content
    expect(isScannedPage(`  ${"x".repeat(MIN_TEXT_CHARS - 1)}  `)).toBe(true);
  });
});

describe("the batch window", () => {
  it("takes a full batch off the bookmark", () => {
    expect(pageWindow(1, 300)).toEqual({ from: 1, to: PAGE_BATCH, count: PAGE_BATCH });
    expect(pageWindow(21, 300)).toEqual({ from: 21, to: 40, count: 20 });
  });

  it("stops at the last page rather than running past the end", () => {
    expect(pageWindow(295, 300)).toEqual({ from: 295, to: 300, count: 6 });
    expect(pageWindow(300, 300)).toEqual({ from: 300, to: 300, count: 1 });
  });

  it("reports nothing left once the bookmark is past the end", () => {
    expect(pageWindow(301, 300).count).toBe(0);
    expect(pageWindow(1, 0).count).toBe(0);
  });

  /* A trial org with 7 pages of allowance left gets 7 pages, not a refusal —
     the document parks only when there is genuinely no room. */
  it("shortens the window to what the allowance allows", () => {
    expect(pageWindow(1, 300, 20, 7)).toEqual({ from: 1, to: 7, count: 7 });
    expect(pageWindow(1, 300, 20, 0).count).toBe(0);
    expect(pageWindow(1, 300, 20, 999)).toEqual({ from: 1, to: 20, count: 20 });
  });

  it("never returns a page 0, whatever the bookmark says", () => {
    expect(pageWindow(0, 10).from).toBe(1);
    expect(pageWindow(-5, 10).from).toBe(1);
  });
});
