/**
 * @jest-environment node
 */
/* An answer on the To decide tab: money is the grant, the job must be this
   workspace's, the answer one the question takes; a new answer replaces the
   old and Undo takes the row away. */

const requireOrg = jest.fn();
jest.mock("@/lib/permissions-server", () => ({ requireOrg: (...a: unknown[]) => requireOrg(...a) }));

const calls: string[] = [];
let jobFound = true;
let writeError: { code?: string; message: string } | null = null;
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (col: string, v: string) => {
        calls.push(`${table}.eq ${col}=${v}`);
        return q;
      };
      q.maybeSingle = async () => ({ data: jobFound ? { uuid: "job-1" } : null, error: null });
      q.upsert = async (row: Record<string, unknown>, opts: unknown) => {
        const { decided_at, ...rest } = row;
        calls.push(`${table}.upsert ${JSON.stringify(rest)} ${JSON.stringify(opts)} at:${typeof decided_at}`);
        return { error: writeError };
      };
      q.delete = () => {
        calls.push(`${table}.delete`);
        const d: Record<string, unknown> = {};
        d.eq = (col: string, v: string) => {
          calls.push(`${table}.eq ${col}=${v}`);
          return Object.assign(Promise.resolve({ error: writeError }), d);
        };
        return d;
      };
      return q;
    },
  },
}));

import { decideJob } from "../analytics-decide";

beforeEach(() => {
  calls.length = 0;
  jobFound = true;
  writeError = null;
  requireOrg.mockReset().mockResolvedValue({ orgId: "org-1", userId: "user-1" });
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

it("asks the money grant, and refuses without it before reading anything", async () => {
  requireOrg.mockRejectedValue(new Error("no"));
  const a = await decideJob("job-1", "kind", "ducted");
  expect(a.ok).toBe(false);
  expect(requireOrg).toHaveBeenCalledWith("workboard_money");
  expect(calls).toEqual([]);
});

it("keeps an answer for this workspace's job, replacing an earlier one", async () => {
  expect(await decideJob("job-1", "kind", "ducted")).toEqual({ ok: true });
  expect(calls).toContain("sm8_jobs.eq org_id=org-1");
  expect(calls).toContain(
    `job_analytics_decisions.upsert {"org_id":"org-1","sm8_job_uuid":"job-1","question":"kind","answer":"ducted","decided_by":"user-1"} {"onConflict":"org_id,sm8_job_uuid,question"} at:string`,
  );
});

it("takes an answer back by removing that one question's row", async () => {
  expect(await decideJob("job-1", "price", null)).toEqual({ ok: true });
  expect(calls).toEqual(
    expect.arrayContaining([
      "job_analytics_decisions.delete",
      "job_analytics_decisions.eq org_id=org-1",
      "job_analytics_decisions.eq sm8_job_uuid=job-1",
      "job_analytics_decisions.eq question=price",
    ]),
  );
});

it("refuses an answer the question doesn't take, and a question there isn't", async () => {
  expect(await decideJob("job-1", "kind", "heat pump")).toEqual({ ok: false, error: "That isn't one of the answers." });
  expect(await decideJob("job-1", "brand", "Daikin")).toEqual({ ok: false, error: "That isn't one of the answers." });
  expect(calls).toEqual([]);
});

it("won't answer for a job that isn't this workspace's", async () => {
  jobFound = false;
  const a = await decideJob("someone-elses", "outcome", "won");
  expect(a.ok).toBe(false);
  expect(calls.some((c) => c.includes("job_analytics_decisions"))).toBe(false);
});

it("says plainly when the table isn't there yet", async () => {
  writeError = { code: "PGRST205", message: "Could not find the table" };
  expect(await decideJob("job-1", "quote", "quote")).toEqual({ ok: false, error: "Answers can't be kept until the database is updated for them." });
  expect(console.error).not.toHaveBeenCalled();
});
