/**
 * @jest-environment node
 *
 * THE QUEUE'S HEARTBEAT. Locked like the nightly route, it sends only what
 * is due, workspace by workspace inside its own time, and says counts.
 */

let authorised = true;
jest.mock("@/lib/integrations/cron-auth", () => ({ authorised: () => authorised }));
const due = jest.fn(async (_n: number): Promise<string[]> => []);
const run = jest.fn(async (orgId: string, _trigger: string, _opts: unknown) => ({ sent: orgId === "org-2" ? 2 : 1, failed: 0 }));
jest.mock("@/lib/integrations/sm8-writes", () => ({
  orgsWithDueSm8Writes: (n: number) => due(n),
  runSm8Writes: (orgId: string, trigger: string, opts: unknown) => run(orgId, trigger, opts),
}));
jest.mock("@/lib/integrations/sm8-write-plan", () => ({ WRITE_LEASE_MARGIN_MS: 5_000 }));

import { GET } from "../sm8-drain/route";

const call = () => GET(new Request("https://app.test/api/cron/sm8-drain", { headers: { authorization: "Bearer x" } }));

beforeEach(() => {
  authorised = true;
  due.mockReset().mockResolvedValue([]);
  run.mockClear();
});

it("refuses without the secret, and sends nothing", async () => {
  authorised = false;
  due.mockResolvedValue(["org-1"]);
  const res = await call();
  expect(res.status).toBe(401);
  expect(due).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

it("sends what is due for each workspace that has something due, as the cron", async () => {
  due.mockResolvedValue(["org-1", "org-2"]);
  const res = await call();
  expect(await res.json()).toEqual({ workspaces: 2, sent: 3, failed: 0, deferred: 0 });
  expect(run).toHaveBeenCalledWith("org-1", "cron", { budgetMs: expect.any(Number) });
  expect(due).toHaveBeenCalledWith(10);
});

it("counts a workspace whose run threw as a failure and carries on", async () => {
  due.mockResolvedValue(["org-1", "org-2"]);
  run.mockImplementationOnce(async () => {
    throw new Error("ServiceM8 unreachable");
  });
  expect(await (await call()).json()).toEqual({ workspaces: 2, sent: 2, failed: 1, deferred: 0 });
});

it("is quiet when nothing is due", async () => {
  expect(await (await call()).json()).toEqual({ workspaces: 0, sent: 0, failed: 0, deferred: 0 });
  expect(run).not.toHaveBeenCalled();
});
