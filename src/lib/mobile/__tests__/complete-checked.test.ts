jest.mock("server-only", () => ({}));

let row: Record<string, unknown> | null = null;
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => {
      const q = { select: () => q, eq: () => q, in: () => q, limit: () => q, maybeSingle: async () => ({ data: row, error: null }) };
      return q;
    },
  },
}));
jest.mock("@/lib/integrations/sm8-writes", () => ({ readSm8WriteState: async () => ({ readable: true }) }));
const queueMarkCompleted = jest.fn(async (..._args: unknown[]) => ({ ok: true, rowId: "r1" }) as { ok: boolean; rowId?: string; refusal?: string });
jest.mock("@/app/actions/sm8-booking-queue", () => ({ queueMarkCompleted: (...a: unknown[]) => queueMarkCompleted(...a) }));

import type { Sm8Press } from "@/lib/integrations/sm8-press";
import { completeChecked } from "../complete-checked";

const press = { orgId: "org" } as unknown as Sm8Press;
const job = (over: Record<string, unknown> = {}) => ({ uuid: "job-1", status: "Work Order", edit_date: "2026-11-12 13:54:59", active: 1, ...over });

beforeEach(() => queueMarkCompleted.mockClear());

/* Checked on Ready to invoice: the Work Order goes Completed, with the edit time the mirror saw. */
it("queues Work Order to Completed with the mirror's edit time", async () => {
  row = job();
  expect(await completeChecked(press, "org", "JOB-1")).toEqual({ queued: true });
  expect(queueMarkCompleted).toHaveBeenCalledTimes(1);
  expect(queueMarkCompleted.mock.calls[0]![2]).toMatchObject({ jobUuid: "job-1", seenEditDate: "2026-11-12 13:54:59" });
});

it("leaves a job that isn't a Work Order", async () => {
  for (const status of ["Quote", "Completed", "Unsuccessful"]) {
    row = job({ status });
    expect((await completeChecked(press, "org", "job-1")).queued).toBe(false);
  }
  expect(queueMarkCompleted).not.toHaveBeenCalled();
});

it("leaves a job taken out of ServiceM8, or not in the mirror", async () => {
  row = job({ active: 0 });
  expect((await completeChecked(press, "org", "job-1")).queued).toBe(false);
  row = null;
  expect((await completeChecked(press, "org", "job-1")).queued).toBe(false);
  expect(queueMarkCompleted).not.toHaveBeenCalled();
});

it("needs a press for the same workspace", async () => {
  row = job();
  expect((await completeChecked(null, "org", "job-1")).queued).toBe(false);
  expect((await completeChecked(press, "other", "job-1")).queued).toBe(false);
  expect(queueMarkCompleted).not.toHaveBeenCalled();
});

it("says why when the queue refuses", async () => {
  row = job();
  queueMarkCompleted.mockResolvedValueOnce({ ok: false, refusal: "not_offered" });
  expect(await completeChecked(press, "org", "job-1")).toEqual({ queued: false, why: "not_offered" });
});
