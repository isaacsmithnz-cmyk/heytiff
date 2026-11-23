/**
 * @jest-environment node
 */

/* A manual photographed on the phone has its pages read once it's in, and
   then stops saying Reading, however that read went. Nothing else is read
   without its Read pages being pressed. */

jest.mock("server-only", () => ({}));

let doc: { scanned_pages: number; pages_reading_until: string | null } | null = null;
const updates: Record<string, unknown>[] = [];
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => {
      const q = {
        select: () => q,
        update: (patch: Record<string, unknown>) => (updates.push(patch), q),
        eq: () => q,
        maybeSingle: async () => ({ data: doc, error: null }),
        then: (res: (v: unknown) => unknown) => res({ data: null, error: null }),
      };
      return q;
    },
  },
}));

const runs: { status: string; pagesRead: number; scannedLeft: number; error?: string }[] = [];
const processScannedPages = jest.fn(async () => runs.shift() ?? { status: "ready", pagesRead: 0, scannedLeft: 0 });
jest.mock("../ocr-run", () => ({ processScannedPages: () => processScannedPages() }));

import { readPhotographedPages } from "../after-ready";

const renew = async () => undefined;

beforeEach(() => {
  updates.length = 0;
  runs.length = 0;
  processScannedPages.mockClear();
});

it("reads a photographed manual's pages, then clears its Reading", async () => {
  doc = { scanned_pages: 50, pages_reading_until: new Date(Date.now() + 60_000).toISOString() };
  runs.push({ status: "ready", pagesRead: 40, scannedLeft: 10 }, { status: "ready", pagesRead: 10, scannedLeft: 0 });
  await readPhotographedPages("d1", "o", renew);
  expect(processScannedPages).toHaveBeenCalledTimes(2);
  expect(updates).toEqual([{ pages_reading_until: null }]);
});

it("clears its Reading when the read fails too", async () => {
  doc = { scanned_pages: 5, pages_reading_until: new Date(Date.now() + 60_000).toISOString() };
  runs.push({ status: "failed", pagesRead: 0, scannedLeft: 5, error: "no" });
  await readPhotographedPages("d1", "o", renew);
  expect(updates).toEqual([{ pages_reading_until: null }]);
});

it("clears it with nothing to read: the photos had words on them", async () => {
  doc = { scanned_pages: 0, pages_reading_until: new Date(Date.now() + 60_000).toISOString() };
  await readPhotographedPages("d1", "o", renew);
  expect(processScannedPages).not.toHaveBeenCalled();
  expect(updates).toEqual([{ pages_reading_until: null }]);
});

it("leaves a scanned PDF added from a file to its own Read pages", async () => {
  doc = { scanned_pages: 30, pages_reading_until: null };
  await readPhotographedPages("d1", "o", renew);
  expect(processScannedPages).not.toHaveBeenCalled();
  expect(updates).toEqual([]);
});
