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
jest.mock("@/lib/tiff/ingest", () => ({
  processBatch: (...a: unknown[]) => processBatch(...(a as [])),
}));

import { maxDuration, POST } from "../ingest/route";

const req = (body: unknown) =>
  new Request("http://localhost/api/tiff/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  jest.clearAllMocks();
  allowed = true;
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

/* A batch reads, chunks, tags and embeds twenty pages of a manual — tens of
   seconds. The ceiling is a route-segment option, which is the whole reason
   this is a route handler and not a server action. */
it("declares the long ceiling the batch needs", () => {
  expect(maxDuration).toBe(300);
});
