/**
 * @jest-environment node
 */

/* Your days to wrap up, kept in HeyTiff (Isaac, 9 November 2026: "Build it"). */

jest.mock("server-only", () => ({}));
let ctx: Record<string, unknown> | Response;
jest.mock("@/lib/mobile/auth", () => ({
  requireMobile: async () => ctx,
  ok: (body: unknown) => Response.json(body),
}));
const applyWrapOps = jest.fn();
const readOwedDays = jest.fn();
jest.mock("@/lib/mobile/wrapups-store", () => ({
  applyWrapOps: (...a: unknown[]) => applyWrapOps(...a),
  readOwedDays: (...a: unknown[]) => readOwedDays(...a),
}));

import { GET, POST } from "../wrapups/route";

const req = (body?: unknown) => new Request("https://x/api/mobile/wrapups", body ? { method: "POST", body: JSON.stringify(body) } : undefined);
const FRI = { on: "2026-11-06", jobs: ["3488"], done: [], noted: [] };

beforeEach(() => {
  ctx = { orgId: "org-1", userId: "auth0|isaac", role: "owner", caps: new Set() };
  applyWrapOps.mockReset().mockResolvedValue([FRI]);
  readOwedDays.mockReset().mockResolvedValue([FRI]);
});

it("reads your own days", async () => {
  expect(await (await GET(req())).json()).toEqual({ owed: [FRI] });
  expect(readOwedDays).toHaveBeenCalledWith("org-1", "auth0|isaac");
});

it("applies the phone's ops in order and answers with the list", async () => {
  const ops = [{ do: "owe", on: "2026-11-06", jobs: ["3488"] }, { do: "settle", on: "2026-11-05" }];
  const res = await POST(req({ ops }));
  expect(await res.json()).toEqual({ owed: [FRI] });
  expect(applyWrapOps).toHaveBeenCalledWith("org-1", "auth0|isaac", [{ ...ops[0], done: [], noted: [] }, ops[1]]);
});

it("refuses what isn't an op, and writes nothing", async () => {
  expect((await POST(req({ ops: [{ do: "owe", on: "yesterday" }] }))).status).toBe(400);
  expect(applyWrapOps).not.toHaveBeenCalled();
});

it("says so when the store fails", async () => {
  applyWrapOps.mockRejectedValueOnce(new Error("Couldn't keep the days to wrap up."));
  const res = await POST(req({ ops: [] }));
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: "Couldn't keep the days to wrap up." });
});

it("a signed-out phone gets the sign-in answer", async () => {
  ctx = new Response(null, { status: 401 });
  expect((await GET(req())).status).toBe(401);
});
