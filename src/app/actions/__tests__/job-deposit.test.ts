/**
 * @jest-environment node
 */
/* The deposit tick: money is the grant, the job must be this workspace's,
   and ticking twice is one row. */

const requireOrg = jest.fn();
jest.mock("@/lib/permissions-server", () => ({ requireOrg: (...a: unknown[]) => requireOrg(...a) }));

const calls: string[] = [];
let jobFound = true;
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
      q.upsert = async (row: unknown, opts: unknown) => {
        calls.push(`${table}.upsert ${JSON.stringify(row)} ${JSON.stringify(opts)}`);
        return { error: null };
      };
      q.delete = () => {
        calls.push(`${table}.delete`);
        const d: Record<string, unknown> = {};
        d.eq = (col: string, v: string) => {
          calls.push(`${table}.eq ${col}=${v}`);
          return Object.assign(Promise.resolve({ error: null }), d);
        };
        return d;
      };
      return q;
    },
  },
}));

import { setNoDeposit } from "../job-deposit";

beforeEach(() => {
  calls.length = 0;
  jobFound = true;
  requireOrg.mockReset().mockResolvedValue({ orgId: "org-1", userId: "user-1" });
});

it("asks the money grant, and refuses without it before reading anything", async () => {
  requireOrg.mockRejectedValue(new Error("no"));
  const a = await setNoDeposit("job-1", true);
  expect(a.ok).toBe(false);
  expect(requireOrg).toHaveBeenCalledWith("workboard_money");
  expect(calls).toEqual([]);
});

it("ticks a job of this workspace's once, however often it's pressed", async () => {
  expect(await setNoDeposit("job-1", true)).toEqual({ ok: true, noDeposit: true });
  expect(calls).toContain("sm8_jobs.eq org_id=org-1");
  expect(calls).toContain(
    `job_no_deposit.upsert {"org_id":"org-1","sm8_job_uuid":"job-1","marked_by":"user-1"} {"onConflict":"org_id,sm8_job_uuid","ignoreDuplicates":true}`
  );
});

it("unticks by taking the row away, only this workspace's", async () => {
  expect(await setNoDeposit("job-1", false)).toEqual({ ok: true, noDeposit: false });
  expect(calls).toEqual(expect.arrayContaining(["job_no_deposit.delete", "job_no_deposit.eq org_id=org-1", "job_no_deposit.eq sm8_job_uuid=job-1"]));
});

it("won't tick a job that isn't this workspace's", async () => {
  jobFound = false;
  const a = await setNoDeposit("someone-elses", true);
  expect(a.ok).toBe(false);
  expect(calls.some((c) => c.includes("job_no_deposit"))).toBe(false);
});
