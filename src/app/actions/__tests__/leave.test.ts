/* Leave actions. Requests re-check the balance server-side, review needs
   `approvals` and never your own, balances need `team`. */

const insert = jest.fn().mockResolvedValue({ error: null });
const update = jest.fn().mockResolvedValue({ error: null });
const upsert = jest.fn().mockResolvedValue({ error: null });

let requestRow: Record<string, unknown> | null = null;
let staffExists = true;
let caps = new Set<string>(["approvals", "team"]);
let myStaffId: string | null = "me";

/* Timesheets whose status the lifecycle guards see: what the (status-filtered)
   locked-sheet query returns. Only ever fill this with submitted/approved
   rows — the filter itself lives in real SQL, not in this stub. */
let sheetRows: { period_start: string; status: string }[] = [];
/** the existing leave_balances row the sync guard reads; null = none yet */
let balanceRow: { source: string } | null = null;

const table = (name: string) => {
  const c: Record<string, unknown> = {};
  const self = () => c;
  c.eq = self;
  c.select = self;
  c.in = self;
  c.maybeSingle = async () => {
    if (name === "leave_requests") return { data: requestRow };
    if (name === "leave_balances") return { data: balanceRow };
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
  c.then = (res: (v: { error: null; data: unknown[] }) => unknown) =>
    Promise.resolve({ error: null, data: name === "timesheets" ? sheetRows : [] }).then(res);
  return c;
};

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: (n: string) => table(n) } }));
jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn().mockResolvedValue({ user: { sub: "auth0|me" }, orgId: "org-1" }) },
}));
jest.mock("@/lib/permissions-server", () => ({ can: jest.fn(async (c: string) => caps.has(c)) }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn(async () => myStaffId) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
// the cancel guard compares against the AU day — pin it or the tests age out
jest.mock("@/lib/au-dates", () => ({ todayInAu: () => "2026-07-27" }));
jest.mock("@/lib/timepay/query", () => {
  const { DEFAULT_SETTINGS } = jest.requireActual("@/components/timepay/logic");
  return { getPaySettings: jest.fn(async () => ({ settings: DEFAULT_SETTINGS, configured: true })) };
});

// control the balance the request guard sees, and the overlap guard's answer
let balances: unknown[] = [];
let requests: unknown[] = [];
let overlaps: { id: string; status: string; startDate: string; endDate: string }[] = [];
jest.mock("@/lib/timepay/leave-query", () => ({
  balancesFor: jest.fn(async () => ({ balances, requests })),
  overlappingRequests: jest.fn(async () => overlaps),
}));

import { revalidatePath } from "next/cache";
import { approveLeave, cancelLeave, declineLeave, requestLeave, setLeaveBalance } from "../leave";

beforeEach(() => {
  [insert, update, upsert].forEach((m) => m.mockClear());
  (revalidatePath as jest.Mock).mockClear();
  requestRow = null;
  staffExists = true;
  caps = new Set(["approvals", "team"]);
  myStaffId = "me";
  balances = [{ kind: "annual", balanceHours: 40, asAt: "2026-07-01", source: "manual" }];
  requests = [];
  overlaps = [];
  sheetRows = [];
  balanceRow = null;
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

  /* One live booking per day. Two overlapping requests would each draw the
     balance while only one could land on the timesheet — and which one won
     was down to whatever order the database returned them in. */
  it("refuses dates that overlap a live request", async () => {
    overlaps = [{ id: "r9", status: "pending", startDate: "2026-08-04", endDate: "2026-08-06" }];
    const res = await requestLeave({ kind: "annual", startDate: "2026-08-03", endDate: "2026-08-05", hours: 24 });
    expect(res.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("cancelling", () => {
  it("cancels your own pending request", async () => {
    requestRow = { status: "pending", start_date: "2026-08-03", end_date: "2026-08-05" };
    expect((await cancelLeave("r1")).ok).toBe(true);
    expect(update).toHaveBeenCalledWith("leave_requests", expect.objectContaining({ status: "cancelled" }));
  });

  it("won't cancel a declined one", async () => {
    requestRow = { status: "declined", start_date: "2026-08-03", end_date: "2026-08-05" };
    expect((await cancelLeave("r1")).ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  /* The docstring always promised "not yet started" — the audit found no date
     comparison in the body. Cancelling a taken block would restore the hours
     while the timesheet rows that paid it stay put. */
  it("won't cancel approved leave that has already started", async () => {
    requestRow = { status: "approved", start_date: "2026-07-20", end_date: "2026-07-29" };
    const res = await cancelLeave("r1");
    expect(res.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("won't cancel approved leave a submitted sheet already carries", async () => {
    requestRow = { status: "approved", start_date: "2026-08-03", end_date: "2026-08-05" };
    sheetRows = [{ period_start: "2026-08-03", status: "submitted" }];
    const res = await cancelLeave("r1");
    expect(res.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("cancels approved future leave nothing has frozen yet", async () => {
    requestRow = { status: "approved", start_date: "2026-08-03", end_date: "2026-08-05" };
    expect((await cancelLeave("r1")).ok).toBe(true);
  });

  it("a pending request can always be withdrawn — it leans on nothing", async () => {
    requestRow = { status: "pending", start_date: "2026-07-20", end_date: "2026-07-22" };
    expect((await cancelLeave("r1")).ok).toBe(true);
  });
});

describe("review", () => {
  const pending = { staff_profile_id: "other", status: "pending", start_date: "2026-08-03", end_date: "2026-08-05" };

  it("needs `approvals`", async () => {
    caps = new Set();
    requestRow = { ...pending };
    expect((await approveLeave("r1")).ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("won't let you approve your own leave", async () => {
    requestRow = { ...pending, staff_profile_id: "me" };
    const res = await approveLeave("r1");
    expect(res).toEqual({ ok: false, error: "You can't review your own leave." });
  });

  it("won't decide one that's already decided", async () => {
    requestRow = { ...pending, status: "approved" };
    expect((await approveLeave("r1")).ok).toBe(false);
  });

  it("approves an eligible request, and the timesheet screen is revalidated", async () => {
    requestRow = { ...pending };
    expect((await approveLeave("r1")).ok).toBe(true);
    expect(update).toHaveBeenCalledWith("leave_requests", expect.objectContaining({ status: "approved", reviewed_by: "me" }));
    // the sheet derives leave on read — approval must reach it without a hard reload
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/my-timesheet");
  });

  it("won't approve on top of leave already approved for them", async () => {
    requestRow = { ...pending };
    overlaps = [{ id: "r2", status: "approved", startDate: "2026-08-05", endDate: "2026-08-07" }];
    expect((await approveLeave("r1")).ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("a pending overlap doesn't block — first approval wins, the other then can't", async () => {
    requestRow = { ...pending };
    overlaps = [{ id: "r2", status: "pending", startDate: "2026-08-05", endDate: "2026-08-07" }];
    expect((await approveLeave("r1")).ok).toBe(true);
  });

  /* The audit's double-pay: approve leave AFTER the week was submitted and
     the frozen sheet keeps paying "worked" while the balance draws. The sheet
     comes back first, so the leave lands on it honestly. */
  it("won't approve into a week that's already gone for review", async () => {
    requestRow = { ...pending };
    sheetRows = [{ period_start: "2026-08-03", status: "submitted" }];
    const res = await approveLeave("r1");
    expect(res.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("declining is always possible — it changes nothing downstream", async () => {
    requestRow = { ...pending };
    sheetRows = [{ period_start: "2026-08-03", status: "approved" }];
    overlaps = [{ id: "r2", status: "approved", startDate: "2026-08-03", endDate: "2026-08-05" }];
    expect((await declineLeave("r1", "Covered by Sam that week")).ok).toBe(true);
  });

  it("requires a reason to decline", async () => {
    requestRow = { ...pending };
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

  /* The comment always promised a sync's row is left alone; the audit found
     the upsert stamping source='manual' over whatever was there. */
  it("refuses to trample a synced balance", async () => {
    balanceRow = { source: "xero" };
    const res = await setLeaveBalance({ staffProfileId: "target", kind: "annual", balanceHours: 100 });
    expect(res.ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("overwrites a manual balance freely — that's whose it is", async () => {
    balanceRow = { source: "manual" };
    const res = await setLeaveBalance({ staffProfileId: "target", kind: "annual", balanceHours: 100 });
    expect(res.ok).toBe(true);
  });

  it("refuses a negative balance and a non-balance kind", async () => {
    expect((await setLeaveBalance({ staffProfileId: "target", kind: "annual", balanceHours: -5 })).ok).toBe(false);
    // @ts-expect-error unpaid is not a BalanceKind
    expect((await setLeaveBalance({ staffProfileId: "target", kind: "unpaid", balanceHours: 10 })).ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });
});
