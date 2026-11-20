/** @jest-environment node */
/* A plan's pages drawn in the headless browser (plans-server.ts draw): the
   set itself is handed to the page from the server, never fetched over the
   headless browser's own network, which failed on Luke's 11 MB set in
   production with "Failed to fetch" (bug 51, 19 November 2026); every other
   request goes on as asked, and a request that fails is named in the error.
   The browser is a fake. */

type Handler = (r: FakeRequest) => void;
type FakeRequest = {
  url: () => string;
  method: () => string;
  isInterceptResolutionHandled: () => boolean;
  respond: jest.Mock;
  continue: jest.Mock;
  failure: () => { errorText: string } | null;
};

const handlers: Record<string, Handler[]> = {};
let intercepting = false;
let pageResult: { pages: unknown; error: string | null } = { pages: { previews: [] }, error: null };
/* what the page asks for once it is opened, and which of those fail */
let asks: { url: string; fails?: string }[] = [];

const request = (url: string, fails?: string): FakeRequest => ({
  url: () => url,
  method: () => "GET",
  isInterceptResolutionHandled: () => false,
  respond: jest.fn(async () => {}),
  continue: jest.fn(async () => {}),
  failure: () => (fails ? { errorText: fails } : null),
});
const sent: FakeRequest[] = [];
/* what the server handed the page to call */
const exposed: Record<string, (...a: unknown[]) => unknown> = {};

jest.mock("server-only", () => ({}));
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));
jest.mock("@/lib/studio/pdf-request", () => ({ signPlanPagesTicket: () => "signed" }));
jest.mock("@/lib/studio/pdf-render", () => ({
  printBase: (o: string) => o,
  launchHeadless: async () => ({
    close: async () => {},
    newPage: async () => ({
      setDefaultTimeout: () => {},
      exposeFunction: async (name: string, fn: (...a: unknown[]) => unknown) => {
        exposed[name] = fn;
      },
      on: (ev: string, fn: Handler) => (handlers[ev] ??= []).push(fn),
      setRequestInterception: async (on: boolean) => {
        intercepting = on;
      },
      goto: async () => {
        for (const a of asks) {
          const r = request(a.url, a.fails);
          sent.push(r);
          if (intercepting) for (const h of handlers.request ?? []) h(r);
          if (a.fails) for (const h of handlers.requestfailed ?? []) h(r);
        }
        return { ok: () => true, status: () => 200 };
      },
      waitForFunction: async () => {},
      evaluate: async () => pageResult,
    }),
  }),
}));

import { draw } from "../plans-server";

const FILE = "https://db.example.co/storage/v1/object/sign/studio-plans/org/o/plan_x.pdf?token=t";

beforeEach(() => {
  for (const k of Object.keys(handlers)) delete handlers[k];
  intercepting = false;
  sent.length = 0;
  asks = [];
  pageResult = { pages: { previews: [] }, error: null };
});

it("answers the page's ask for the set with the server's own bytes, and lets the rest go on", async () => {
  asks = [{ url: "https://app.test/_next/static/chunks/a.js" }, { url: FILE }];
  const bytes = Buffer.from("%PDF-1.7 the set");
  await draw({ orgId: "o", url: FILE, kind: "pdf" }, "https://app.test", { bytes, type: "application/pdf" });
  expect(intercepting).toBe(true);
  const [chunk, set] = sent;
  expect(chunk.continue).toHaveBeenCalled();
  expect(chunk.respond).not.toHaveBeenCalled();
  expect(set.continue).not.toHaveBeenCalled();
  expect(set.respond).toHaveBeenCalledWith(expect.objectContaining({ status: 200, contentType: "application/pdf", body: bytes }));
  expect(set.respond.mock.calls[0][0].headers["access-control-allow-origin"]).toBe("*");
});

it("names a request that failed in the page's error", async () => {
  asks = [{ url: "https://db.example.co/storage/v1/object/upload/sign/studio-plans/org/o/p.png?token=t", fails: "net::ERR_CONNECTION_RESET" }];
  pageResult = { pages: null, error: "Failed to fetch" };
  await expect(draw({ orgId: "o", url: FILE, kind: "pdf", full: [] }, "https://app.test", { bytes: Buffer.from("x"), type: "application/pdf" })).rejects.toThrow(
    "Failed to fetch (db.example.co/storage/v1/object/upload/sign/studio-plans/org/o/p.png: net::ERR_CONNECTION_RESET)",
  );
});

it("says the page's error alone when nothing failed on the way", async () => {
  pageResult = { pages: null, error: "page 3 didn't draw" };
  await expect(draw({ orgId: "o", url: FILE, kind: "pdf" }, "https://app.test")).rejects.toThrow(/^page 3 didn't draw$/);
});

it("hands the set to the page in pieces, off the network", async () => {
  /* 3570, 20 November 2026: the 11 MB set handed over whole failed to be taken in */
  const bytes = Buffer.alloc(5 * 1024 * 1024, 7);
  await draw({ orgId: "o", url: FILE, kind: "pdf" }, "https://app.test", { bytes, type: "application/pdf" });
  expect(exposed.__htFileSize!()).toBe(bytes.length);
  const pieces = [0, 1, 2, 3].map((i) => Buffer.from(exposed.__htFileChunk!(i) as string, "base64"));
  expect(pieces.map((p) => p.length)).toEqual([2 * 1024 * 1024, 2 * 1024 * 1024, 1024 * 1024, 0]);
  expect(Buffer.concat(pieces).equals(bytes)).toBe(true);
});
