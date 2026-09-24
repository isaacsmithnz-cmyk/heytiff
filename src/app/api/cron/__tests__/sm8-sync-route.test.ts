/**
 * @jest-environment node
 *
 * The nightly sweep's writes fit inside the function's window. A write
 * run's budget only stops it CLAIMING: a send claimed at the last moment can
 * hold its row for a whole lease. So the last claim of the night comes a
 * lease and a margin before maxDuration, across every workspace — what is
 * left waits for the next page load or the next night.
 */

jest.mock("@/lib/integrations/cron-auth", () => ({ authorised: () => true }));
jest.mock("@/lib/integrations/sm8-sync", () => ({
  sweepableSm8Orgs: jest.fn(async () => []),
  runSm8Sync: jest.fn(),
}));

let clock = 0;
const budgets: (number | undefined)[] = [];
/** How long each workspace's write run takes, in turn. */
let takes: number[] = [];
jest.mock("@/lib/integrations/sm8-writes", () => ({
  orgsWithDueSm8Writes: jest.fn(async () => ["a", "b", "c", "d"]),
  runSm8Writes: jest.fn(async (_org: string, _trigger: string, opts: { budgetMs?: number }) => {
    budgets.push(opts.budgetMs);
    clock += takes.shift() ?? 0;
    return { done: 1, sent: 1, trial: 0, failed: 0, again: 0, lost: 0, stopped: null };
  }),
}));

import { GET, maxDuration } from "../sm8-sync/route";
import { WRITE_LEASE_MARGIN_MS, WRITE_LEASE_MS } from "@/lib/integrations/sm8-write-plan";

beforeEach(() => {
  clock = Date.parse("2026-09-25T20:00:00Z");
  budgets.length = 0;
  jest.spyOn(Date, "now").mockImplementation(() => clock);
});
afterEach(() => jest.restoreAllMocks());

const sweep = async () => (await GET(new Request("https://app.test/api/cron/sm8-sync"))).json();

describe("the nightly sweep's writes", () => {
  const deadline = maxDuration * 1000 - WRITE_LEASE_MS - WRITE_LEASE_MARGIN_MS;

  it("gives each workspace 30 s of claiming while there is room", async () => {
    takes = [1_000, 1_000, 1_000, 1_000];
    const body = await sweep();
    expect(budgets).toEqual([30_000, 30_000, 30_000, 30_000]);
    expect(body.writes).toMatchObject({ orgs: 4, sent: 4, deferred: 0 });
  });

  it("claims nothing past one deadline for the whole night, so the last send ends inside the window", async () => {
    // the first workspace's sends run long; the second gets what is left
    takes = [deadline - 10_000, 20_000];
    const body = await sweep();
    expect(budgets).toEqual([30_000, 10_000]);
    expect(body.writes).toMatchObject({ orgs: 4, sent: 2, deferred: 2 });
    // a send claimed at the deadline, held for a whole lease, still ends in time
    expect(deadline + WRITE_LEASE_MS).toBeLessThan(maxDuration * 1000);
  });
});
