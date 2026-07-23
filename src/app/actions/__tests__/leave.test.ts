/* Leave actions. Requests re-check the balance server-side, review needs
   `approvals` and never your own, balances need `team`. */

const insert = jest.fn().mockResolvedValue({ error: null });
const update = jest.fn().mockResolvedValue({ error: null });
const upsert = jest.fn().mockResolvedValue({ error: null });

let requestRow: Record<string, unknown> | null = null;
let staffExists = true;
let caps = new Set<string>(["approvals", "team"]);
let myStaffId: string | null = "me";

const table = (name: string) => {
  const c: Record<string, unknown> = {};
  const self = () => c;
  c.eq = self;
  c.select = self;
  c.maybeSingle = async () => {
    if (name === "leave_requests") return { data: requestRow };
    return { data: staffExists ? { id: "target" } : null };
  };
  c.insert = (row: unknown) => {
    insert(name, row);
    return Promise.resolve({ error: null });
  };
  c.update = (row: unknown) => {
    update(name, row);
    return c;
  };
  c.upsert = (row: unknown) => {
    upsert(name, row);
    return Promise.resolve({ error: null });
  };
  c.then = (res: (v: { error: null }) => unknown) => Promise.resolve({ error: null }).then(res);
  return c;
};

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: (n: string) => table(n) } }));
jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn().mockResolvedValue({ user: { sub: "auth0|me" }, orgId: "org-1" }) },
}));
jest.mock("@/lib/permissions-server", () => ({ can: jest.fn(async (c: string) => caps.has(c)) }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn(async () => myStaffId) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

// control the balance the request guard sees
let balances: unknown[] = [];
let requests: unknown[] = [];
jest.mock("@/lib/timepay/leave-query", () => ({
  balancesFor: jest.fn(async () => ({ balances, requests })),
}));

import { approveLeave, cancelLeave, declineLeave, requestLeave, setLeaveBalance } from "../leave";

beforeEach(() => {
  [insert, update, upsert].forEach((m) => m.mockClear());
  requestRow = null;
  staffExists = true;
  caps = new Set(["approvals", "team"]);
  myStaffId = "me";
  balances = [{ kind: "annual", balanceHours: 40, asAt: "2026-07-01", source: "manual" }];
  requests = [];
});

describe("requesting leave", () => {
  it("needs no capability and books against your own record", async () => {
    caps = new Set();
    const res = await requestLeave({ kind: "annual", startDate: "2026-08-03", endDate: "2026-08-05", hours: 24 });
    expect(res).toEqual({ ok: true });
    expect(insert).toHaveBeenCalledWith(
      "leave_requests",
      expect.objectContaining({ staff_profile_id: "me", kind: "annual", hours: 24, status: "pending" }),
    );
  });

  it("refuses more than the available balance — whatever the form allowed", async () => {
    const res = await requestLeave({ kind: "annual", startDate: "2026-08-03", endDate: "2026-08-14", hours: 60 });
    expect(res.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("nets existing bookings when checking", async () => {
    requests = [{ kind: "annual", hours: 30, status: "approved", startDate: "2026-08-01" }];
    // 40 − 30 = 10 available; asking 16 fails
    expect((await requestLeave({ kind: "annual", startDate: "2026-08-03", endDate: "2026-08-04", hours: 16 })).ok).toBe(false);
    // asking 10 fits
    expect((await requestLeave({ kind: "annual", startDate: "2026-08-03", endDate: "2026-08-04", hours: 10 })).ok).toBe(true);
  });

  it("never restricts unpaid leave", async () => {
    balances = [];
    const res = await requestLeave({ kind: "unpaid", startDate: "2026-08-03", endDate: "2026-08-28", hours: 152 });
    expect(res.ok).toBe(true);
  });

  it("rejects a bad range or zero hours", async () => {
    expect((await requestLeave({ kind: "annual", startDate: "2026-08-10", endDate: "2026-08-03", hours: 8 })).ok).toBe(false);
    expect((await requestLeave({ kind: "annual", startDate: "2026-08-03", endDate: "2026-08-03", hours: 0 })).ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("cancelling", () => {
  it("cancels your own pending request", async () => {
    requestRow = { status: "pending" };
    expect((await cancelLeave("r1")).ok).toBe(true);
    expect(update).toHaveBeenCalledWith("leave_requests", expect.objectContaining({ status: "cancelled" }));
  });

  it("won't cancel a declined one", async () => {
    requestRow = { status: "declined" };
    expect((await cancelLeave("r1")).ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("review", () => {
  it("needs `approvals`", async () => {
    caps = new Set();
    requestRow = { staff_profile_id: "other", status: "pending" };
    expect((await approveLeave("r1")).ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("won't let you approve your own leave", async () => {
    requestRow = { staff_profile_id: "me", status: "pending" };
    const res = await approveLeave("r1");
    expect(res).toEqual({ ok: false, error: "You can't review your own leave." });
  });

  it("won't decide one that's already decided", async () => {
    requestRow = { staff_profile_id: "other", status: "approved" };
    expect((await approveLeave("r1")).ok).toBe(false);
  });

  it("approves an eligible request", async () => {
    requestRow = { staff_profile_id: "other", status: "pending" };
    expect((await approveLeave("r1")).ok).toBe(true);
    expect(update).toHaveBeenCalledWith("leave_requests", expect.objectContaining({ status: "approved", reviewed_by: "me" }));
  });

  it("requires a reason to decline", async () => {
    requestRow = { staff_profile_id: "other", status: "pending" };
    expect((await declineLeave("r1", "  ")).ok).toBe(false);
    expect((await declineLeave("r1", "Clashes with the Dandenong job")).ok).toBe(true);
    expect(update).toHaveBeenCalledWith(
      "leave_requests",
      expect.objectContaining({ status: "declined", review_note: "Clashes with the Dandenong job" }),
    );
  });
});

describe("balances", () => {
  it("need `team`, and are always written as manual", async () => {
    caps = new Set(["approvals"]);
    expect((await setLeaveBalance({ staffProfileId: "target", kind: "annual", balanceHours: 152 })).ok).toBe(false);

    caps = new Set(["team"]);
    expect((await setLeaveBalance({ staffProfileId: "target", kind: "annual", balanceHours: 152 })).ok).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      "leave_balances",
      expect.objectContaining({ kind: "annual", balance_hours: 152, source: "manual", synced_at: null }),
    );
  });

  it("refuses a negative balance and a non-balance kind", async () => {
    expect((await setLeaveBalance({ staffProfileId: "target", kind: "annual", balanceHours: -5 })).ok).toBe(false);
    // @ts-expect-error unpaid is not a BalanceKind
    expect((await setLeaveBalance({ staffProfileId: "target", kind: "unpaid", balanceHours: 10 })).ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });
});
