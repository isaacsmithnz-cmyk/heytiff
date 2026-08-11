/**
 * @jest-environment node
 *
 * The ingest door. A route handler is reachable directly — the library page
 * posting to it is not the control — so the gate is checked here, and it is
 * `tiff_manage` rather than `tiff`: reading the library is the staff tier,
 * spending the org's monthly page allowance is not.
 */

const getSession = jest.fn();
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: () => getSession() } }));

let allowed = true;
const can = jest.fn<Promise<boolean>, [capability: string]>(async () => allowed);
jest.mock("@/lib/permissions-server", () => ({ can: (c: string) => can(c) }));

const processBatch = jest.fn(async () => ({
  status: "processing" as const,
  pagesDone: 20,
  pageCount: 300,
  chunkCount: 18,
}));
type Progress = { status: string; pagesDone: number; pageCount: number; chunkCount: number };
/* Typed with its arguments so the budget assertion below can read call[2] —
   an untyped jest.fn() has a zero-length tuple for its calls. */
const driveDocument = jest.fn<Promise<Progress>, [string, string, number?]>(async () => ({
  status: "ready",
  pagesDone: 300,
  pageCount: 300,
  chunkCount: 250,
}));
const readProgress = jest.fn(async () => ({
  status: "processing" as const,
  pagesDone: 40,
  pageCount: 300,
  chunkCount: 33,
}));
jest.mock("@/lib/tiff/ingest", () => ({
  processBatch: (...a: unknown[]) => processBatch(...(a as [])),
  driveDocument: (...a: unknown[]) => driveDocument(...(a as [string, string, number?])),
  readProgress: (...a: unknown[]) => readProgress(...(a as [])),
  DRIVE_BUDGET_MS: 240_000,
}));

let claims = true;
const claimDocument = jest.fn(async () => claims);
const releaseLease = jest.fn(async () => {});
jest.mock("@/lib/tiff/lease", () => ({
  claimDocument: (...a: unknown[]) => claimDocument(...(a as [])),
  releaseLease: (...a: unknown[]) => releaseLease(...(a as [])),
}));

/* `after` runs the continuation once the response has gone. Captured rather
   than executed, so a test can decide when — and whether — it runs. */
const afterCallbacks: (() => unknown)[] = [];
jest.mock("next/server", () => ({
  after: (cb: () => unknown) => {
    afterCallbacks.push(cb);
  },
}));

import { maxDuration, POST } from "../ingest/route";

const req = (body: unknown) =>
  new Request("http://localhost/api/tiff/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const runAfter = async () => {
  for (const cb of afterCallbacks.splice(0)) await cb();
};

beforeEach(() => {
  jest.clearAllMocks();
  allowed = true;
  claims = true;
  afterCallbacks.length = 0;
  processBatch.mockResolvedValue({
    status: "processing",
    pagesDone: 20,
    pageCount: 300,
    chunkCount: 18,
  } as never);
  getSession.mockResolvedValue({ user: { sub: "auth0|me" }, orgId: "org-1" });
});

describe("the gate", () => {
  it("401s with no session, before it looks at anything else", async () => {
    getSession.mockResolvedValue(null);
    const res = await POST(req({ documentId: "doc-1" }));

    expect(res.status).toBe(401);
    expect(processBatch).not.toHaveBeenCalled();
  });

  // a member mid-invite has a session and no org — and no library to ingest into
  it("401s for a session with no org", async () => {
    getSession.mockResolvedValue({ user: { sub: "auth0|me" } });
    expect((await POST(req({ documentId: "doc-1" }))).status).toBe(401);
    expect(processBatch).not.toHaveBeenCalled();
  });

  it("403s without tiff_manage, and asks for exactly that capability", async () => {
    allowed = false;
    const res = await POST(req({ documentId: "doc-1" }));

    expect(res.status).toBe(403);
    expect(can).toHaveBeenCalledWith("tiff_manage");
    expect(processBatch).not.toHaveBeenCalled();
  });
});

describe("the batch", () => {
  it("processes the document in the caller's own org and returns the progress", async () => {
    const res = await POST(req({ documentId: " doc-1 " }));

    // the org comes from the session, never from the body
    expect(processBatch).toHaveBeenCalledWith("doc-1", "org-1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "processing",
      pagesDone: 20,
      pageCount: 300,
      chunkCount: 18,
      // work carries on behind the answer, so the caller waits rather than asks
      continuing: true,
    });
  });

  /* processBatch never throws: a failure is already on the row with a reason.
     So a failed document is a 200 — the CALL worked, and the caller's job is
     to render the state, not to retry a 500. */
  it("answers 200 for a document that failed", async () => {
    processBatch.mockResolvedValue({
      status: "failed",
      pagesDone: 40,
      pageCount: 300,
      chunkCount: 33,
      error: "That PDF couldn't be opened.",
    } as never);

    const res = await POST(req({ documentId: "doc-1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "failed" });
  });

  it("passes the paused state and its reset date straight through", async () => {
    processBatch.mockResolvedValue({
      status: "paused",
      pagesDone: 60,
      pageCount: 300,
      chunkCount: 51,
      resetsOn: "2026-09-01",
    } as never);

    expect(await (await POST(req({ documentId: "doc-1" }))).json()).toMatchObject({
      status: "paused",
      resetsOn: "2026-09-01",
    });
  });
});

describe("a body that makes no sense", () => {
  it.each([
    ["no document id", {}],
    ["an id that isn't a string", { documentId: 7 }],
    ["an empty id", { documentId: "  " }],
  ])("400s on %s, without processing anything", async (_label, body) => {
    expect((await POST(req(body))).status).toBe(400);
    expect(processBatch).not.toHaveBeenCalled();
  });

  it("400s on a body that isn't JSON", async () => {
    const res = await POST(
      new Request("http://localhost/api/tiff/ingest", { method: "POST", body: "not json" })
    );
    expect(res.status).toBe(400);
    expect(processBatch).not.toHaveBeenCalled();
  });
});

/* THE HALF THAT SURVIVES THE TAB.

   Closing the library used to strand a document mid-read — one manual sat on
   page 21 of 32 for sixty-three minutes waiting for somebody to come back. The
   request that starts the work now finishes it, and the claim is what stops
   two tabs doing the same pages twice. */
describe("finishing without the browser", () => {
  it("keeps reading after the response, and hands the claim back when done", async () => {
    await POST(req({ documentId: "doc-1" }));

    expect(claimDocument).toHaveBeenCalledWith("doc-1", "org-1");
    // nothing has continued yet — it is scheduled, not run
    expect(driveDocument).not.toHaveBeenCalled();

    await runAfter();
    expect(driveDocument).toHaveBeenCalledTimes(1);
    expect(releaseLease).toHaveBeenCalledWith("doc-1", "org-1");
  });

  /* The continuation shares this invocation's ceiling, so the budget it gets
     is what the first batch LEFT, not a fresh one. */
  it("gives the continuation only what is left of the invocation", async () => {
    await POST(req({ documentId: "doc-1" }));
    await runAfter();

    const budget = driveDocument.mock.calls[0][2] ?? 0;
    expect(budget).toBeLessThanOrEqual(240_000);
    expect(budget).toBeGreaterThan(0);
  });

  /* A document that finished in the first batch has nothing to continue, and
     the claim must not be held until it expires. */
  it("schedules nothing and releases at once when the batch settled it", async () => {
    processBatch.mockResolvedValue({
      status: "ready",
      pagesDone: 300,
      pageCount: 300,
      chunkCount: 250,
    } as never);

    const res = await POST(req({ documentId: "doc-1" }));

    expect(afterCallbacks).toHaveLength(0);
    expect(releaseLease).toHaveBeenCalledWith("doc-1", "org-1");
    expect(await res.json()).not.toHaveProperty("continuing");
  });

  /* Somebody else is reading it — another tab, or this invocation's own
     predecessor. Not an error, and nothing is processed twice. */
  it("answers with the row's own state when the claim is taken", async () => {
    claims = false;
    const res = await POST(req({ documentId: "doc-1" }));

    expect(processBatch).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(0);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "processing",
      pagesDone: 40,
      pageCount: 300,
      chunkCount: 33,
      busy: true,
    });
  });

  /* The claim must never be left held by a continuation that threw — the next
     caller would wait out the whole lease for nothing. */
  it("hands the claim back even if the continuation blows up", async () => {
    driveDocument.mockRejectedValue(new Error("boom") as never);
    await POST(req({ documentId: "doc-1" }));

    await expect(runAfter()).rejects.toThrow("boom");
    expect(releaseLease).toHaveBeenCalledWith("doc-1", "org-1");
  });
});

/* A batch reads, chunks, tags and embeds twenty pages of a manual — tens of
   seconds. The ceiling is a route-segment option, which is the whole reason
   this is a route handler and not a server action. */
it("declares the long ceiling the batch needs", () => {
  expect(maxDuration).toBe(300);
});
