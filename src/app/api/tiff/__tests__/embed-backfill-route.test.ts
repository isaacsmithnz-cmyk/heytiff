/**
 * @jest-environment node
 *
 * The backfill door. Same shape as the ingest door and gated the same way: a
 * route handler is reachable directly, so the check is here rather than on the
 * screen that posts to it, and it is `tiff_manage` — reading the library is
 * the staff tier, spending the org's Voyage requests is not.
 */

const getSession = jest.fn();
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: () => getSession() } }));

let allowed = true;
const can = jest.fn<Promise<boolean>, [capability: string]>(async () => allowed);
jest.mock("@/lib/permissions-server", () => ({ can: (c: string) => can(c) }));

const backfillBatch = jest.fn(async () => ({ done: 64, remaining: 42 }));
jest.mock("@/lib/tiff/backfill", () => ({
  backfillBatch: (...a: unknown[]) => backfillBatch(...(a as [])),
}));

import { maxDuration, POST } from "../embed-backfill/route";

beforeEach(() => {
  jest.clearAllMocks();
  allowed = true;
  getSession.mockResolvedValue({ user: { sub: "auth0|me" }, orgId: "org-1" });
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe("the gate", () => {
  it("401s with no session, before it looks at anything else", async () => {
    getSession.mockResolvedValue(null);
    const res = await POST();

    expect(res.status).toBe(401);
    expect(backfillBatch).not.toHaveBeenCalled();
  });

  // a member mid-invite has a session and no org — and no library to fill in
  it("401s for a session with no org", async () => {
    getSession.mockResolvedValue({ user: { sub: "auth0|me" } });
    expect((await POST()).status).toBe(401);
    expect(backfillBatch).not.toHaveBeenCalled();
  });

  it("403s without tiff_manage, and asks for exactly that capability", async () => {
    allowed = false;
    const res = await POST();

    expect(res.status).toBe(403);
    expect(can).toHaveBeenCalledWith("tiff_manage");
    expect(backfillBatch).not.toHaveBeenCalled();
  });
});

describe("the batch", () => {
  it("fills in the caller's own org and hands back what is left", async () => {
    const res = await POST();

    // the org comes from the session; this route takes no body at all
    expect(backfillBatch).toHaveBeenCalledWith("org-1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ done: 64, remaining: 42 });
  });

  /* backfillBatch reports its own failures as a reason. A 200 with a reason is
     the normal shape — the CALL worked, and the loop's job is to render what
     it says rather than retry a 500. */
  it("passes a rate-limited stop straight through, as a 200", async () => {
    backfillBatch.mockResolvedValue({
      done: 0,
      remaining: 106,
      stopped: "rate-limited",
    } as never);

    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ stopped: "rate-limited", remaining: 106 });
  });

  it("never throws into the browser, even when the client below does", async () => {
    backfillBatch.mockRejectedValue(new Error("connection reset"));

    const res = await POST();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ done: 0, remaining: 0, stopped: "failed" });
  });
});

/* Sixty-four passages is a Voyage request plus sixty-four writes. The ceiling
   is a route-segment option, which is the whole reason this is a route handler
   and not a server action. */
it("declares the long ceiling the batch needs", () => {
  expect(maxDuration).toBe(300);
});
