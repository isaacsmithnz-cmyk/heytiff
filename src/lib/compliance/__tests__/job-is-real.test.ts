/**
 * @jest-environment node
 */

/* A job deleted in ServiceM8 stays in the mirror as active 0 — ServiceM8's
   deletes are soft — and nothing may go to it: not a file sent to ServiceM8,
   not a paper, not an email. The fake applies every eq filter the way
   PostgREST would, so a query that forgets `active` finds the deleted job. */

type Job = { org_id: string; uuid: string; active: number };
let jobs: Job[] = [];

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table !== "sm8_jobs") throw new Error(`unexpected table ${table}`);
      const filters: [string, unknown][] = [];
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (col: string, v: unknown) => {
        filters.push([col, v]);
        return q;
      };
      q.maybeSingle = async () => ({
        data: jobs.find((j) => filters.every(([c, v]) => (j as Record<string, unknown>)[c] === v)) ?? null,
        error: null,
      });
      return q;
    },
  },
}));
jest.mock("@/lib/auth0", () => ({ auth0: {} }));
jest.mock("@/lib/permissions-server", () => ({ can: jest.fn() }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn() }));
jest.mock("@/lib/org/query", () => ({ orgExpiryWindow: jest.fn() }));
jest.mock("@/lib/workboard/all-jobs-query", () => ({ familyMediaSources: jest.fn() }));
jest.mock("@/lib/compliance/query", () => ({ readJobPapers: jest.fn() }));

import { jobIsReal } from "@/lib/compliance/send";

beforeEach(() => {
  jobs = [
    { org_id: "o1", uuid: "live-job", active: 1 },
    { org_id: "o1", uuid: "deleted-job", active: 0 },
    { org_id: "o2", uuid: "other-org-job", active: 1 },
  ];
});

test("a job in the mirror is real", async () => {
  expect(await jobIsReal("o1", "live-job")).toBe(true);
});

test("a job deleted in ServiceM8 (active 0) is not: nothing goes to it", async () => {
  expect(await jobIsReal("o1", "deleted-job")).toBe(false);
});

test("a job that isn't in the mirror, or is another workspace's, is not", async () => {
  expect(await jobIsReal("o1", "no-such-job")).toBe(false);
  expect(await jobIsReal("o1", "other-org-job")).toBe(false);
});
