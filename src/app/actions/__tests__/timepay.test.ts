/* Time & Pay actions. Entry is intrinsic, review needs `approvals`, and a
   week that's gone for review is closed to its owner. */

const upsert = jest.fn().mockResolvedValue({ error: null });
const del = jest.fn();

/* Sheet status is keyed by period_start (the blanket `sheetStatus` covers any
   period not named), because the forgery scenarios below hinge on ONE period
   being locked while a neighbouring made-up one has no row at all. */
let sheetStatus: string | null = "draft";
let sheetStatusByPeriod: Record<string, string | null> = {};
let staffExists = true;
let caps = new Set<string>(["approvals", "financials"]);
let myStaffId: string | null = "me";
/* Which state each public_holidays query filtered on — the materialise test
   asserts the org fallback reached the calendar read. */
const holidayStateAsks: unknown[] = [];
/* Approved leave rows (raw DB shape) the presumption will find — for the
   provenance test: a materialised leave day must carry its request's id. */
let leaveRows: Record<string, unknown>[] = [];

const update = jest.fn();

/* A chainable query stub. Every filter/ordering method returns the builder, so
   a query can grow new clauses without this mock needing to learn them — which
   it had to twice already. Only the methods that END a chain, or that we
   assert on, are real. */
const table = (name: string) => {
  const filters: Record<string, unknown> = {};
  const c: Record<string, unknown> = {};
  /* Returns the PROXY, not the bare object — a chain that falls through to an
     unhandled method has to keep falling through on the next one too. */
  let proxy: Record<string, unknown>;
  const self = () => proxy;
  c.select = self;
  /* `eq` records what it filtered on: the forgery tests below need to know
     WHICH period a status was asked for, not just that one was. */
  c.eq = (col: string, v: unknown) => {
    filters[col] = v;
    if (name === "public_holidays" && col === "state") holidayStateAsks.push(v);
    return proxy;
  };
  c.maybeSingle = async () => {
    if (name === "timesheets") {
      const period = filters.period_start as string;
      const status = period in sheetStatusByPeriod ? sheetStatusByPeriod[period] : sheetStatus;
      return { data: status ? { status } : null };
    }
    if (name === "pay_settings") return { data: null }; // DEFAULT_SETTINGS: Weekly, weeks start Monday
    // the org's home state — what a stateless staff card falls back to
    if (name === "organizations") return { data: { state: "NSW" } };
    return { data: staffExists ? { id: "target" } : null };
  };
  c.upsert = (row: unknown) => {
    upsert(name, row);
    return Promise.resolve({ error: null });
  };
  c.update = (row: unknown) => {
    update(name, row);
    return proxy;
  };
  c.delete = () => {
    del(name);
    return proxy;
  };
  // a resolved chain reads as "no rows, no error" — the presumption then has
  // nothing stored to keep and fills the week itself, which is the case worth
  // testing here. Leave is the exception: tests may plant approved bookings.
  c.then = (res: (v: { error: null; data: unknown[] }) => unknown) =>
    Promise.resolve({ error: null, data: name === "leave_requests" ? leaveRows : [] }).then(res);
  proxy = new Proxy(c, {
    get: (t, k: string) => (k in t ? t[k] : self),
  });
  return proxy;
};

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: (n: string) => table(n) } }));
jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn().mockResolvedValue({ user: { sub: "auth0|me" }, orgId: "org-1" }) },
}));
jest.mock("@/lib/permissions-server", () => ({ can: jest.fn(async (c: string) => caps.has(c)) }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn(async () => myStaffId) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import {
  approveWeek,
  saveDay,
  saveMyHours,
  savePaySettings,
  sendBackWeek,
  submitWeek,
} from "../timepay";
import { DEFAULT_SETTINGS } from "@/components/timepay/logic";

const MONDAY = "2026-06-29";

beforeEach(() => {
  [upsert, del, update].forEach((m) => m.mockClear());
  sheetStatus = "draft";
  sheetStatusByPeriod = {};
  staffExists = true;
  caps = new Set(["approvals", "financials"]);
  myStaffId = "me";
  holidayStateAsks.length = 0;
  leaveRows = [];
});

describe("entering your own hours", () => {
  it("needs no capability, and writes against the right date", async () => {
    caps = new Set(); // nothing at all
    const res = await saveDay(MONDAY, 2, { t: "work", in: "7:00 AM", out: "3:30 PM", h: 8 });
    expect(res).toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledWith(
      "time_entries",
      expect.objectContaining({ work_date: "2026-07-01", kind: "work", hours: 8, staff_profile_id: "me" }),
    );
  });

  it("clears a day rather than storing a zero-hour entry", async () => {
    await saveDay(MONDAY, 0, { t: "empty" });
    expect(del).toHaveBeenCalledWith("time_entries");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("refuses a worked day with no times", async () => {
    expect((await saveDay(MONDAY, 0, { t: "work", in: "", out: "", h: 8 })).ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  /* The UI offers only "worked" and "didn't work" — leave, sick and public
     holidays arrive from the leave module and the org calendar. The action is
     the control, not the screen: a crafted call must not be able to write a
     paid absence with no request, no balance drawdown and no approver. */
  it("refuses leave, sick and public-holiday kinds outright", async () => {
    for (const t of ["leave", "sick", "ph"] as const) {
      const res = await saveDay(MONDAY, 0, { t, h: 8 });
      expect(res.ok).toBe(false);
    }
    expect(upsert).not.toHaveBeenCalled();
  });

  /* HOURS ARE DERIVED, NEVER TYPED — the server proves the stored hours fit
     between the typed clocks. The bound is the span (a shorter day is a
     longer break, which is legitimate); more hours than the clocks allow is
     forged pay. */
  it("refuses hours the clocks can't contain, and unreadable clocks", async () => {
    expect((await saveDay(MONDAY, 0, { t: "work", in: "7:00 AM", out: "3:30 PM", h: 24 })).ok).toBe(false);
    expect((await saveDay(MONDAY, 0, { t: "work", in: "x", out: "y", h: 8 })).ok).toBe(false);
    expect((await saveDay(MONDAY, 0, { t: "work", in: "7:00 AM", out: "3:30 PM", h: Number.NaN })).ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("keeps a day whose shorter hours are a longer break", async () => {
    // 7:00–3:30 is an 8.5h span; 7.5h stored = a one-hour break that day
    const res = await saveDay(MONDAY, 2, { t: "work", in: "7:00 AM", out: "3:30 PM", h: 7.5 });
    expect(res).toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledWith(
      "time_entries",
      expect.objectContaining({ kind: "work", hours: 7.5 }),
    );
  });

  it("refuses a day index outside the week", async () => {
    expect((await saveDay(MONDAY, 7, { t: "off" })).ok).toBe(false);
    expect((await saveDay(MONDAY, -1, { t: "off" })).ok).toBe(false);
  });

  it("locks the week once it's submitted, and again once approved", async () => {
    sheetStatus = "submitted";
    expect((await saveDay(MONDAY, 0, { t: "off" })).ok).toBe(false);
    sheetStatus = "approved";
    expect((await saveDay(MONDAY, 0, { t: "off" })).ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("reopens it when a manager sends it back", async () => {
    sheetStatus = "sent_back";
    expect((await saveDay(MONDAY, 0, { t: "work", in: "7:00 AM", out: "3:00 PM", h: 8 })).ok).toBe(true);
  });

  it("clears the old question when the week is submitted again", async () => {
    sheetStatus = "sent_back";
    await submitWeek(MONDAY);
    expect(upsert).toHaveBeenCalledWith(
      "timesheets",
      expect.objectContaining({ status: "submitted", review_note: null, reviewed_by: null }),
    );
  });

  it("saves a day nobody worked, and it carries no hours", async () => {
    const res = await saveDay(MONDAY, 1, { t: "off" });
    expect(res).toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledWith(
      "time_entries",
      expect.objectContaining({ work_date: "2026-06-30", kind: "off", hours: 0 }),
    );
  });
});

/* Submitting is what turns the presumption into a record.

   Up to here a normal Tuesday is derived and no row exists for it. That is
   right for a live week and wrong for one that has gone for approval: if the
   org changed its normal finish time in August, a June sheet must not restate
   itself. So submit writes the presumed days down as they stood. */
describe("submitting writes the week down", () => {
  it("materialises the presumed weekdays before it sends the sheet", async () => {
    await submitWeek(MONDAY);
    const entryWrite = upsert.mock.calls.find(
      ([t, rows]) => t === "time_entries" && Array.isArray(rows),
    );
    expect(entryWrite).toBeDefined();
    const rows = entryWrite![1] as Record<string, unknown>[];
    // Mon–Fri of a period long past: five ordinary days, no weekend
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({
      work_date: "2026-06-29",
      kind: "work",
      start_time: "7:00 AM",
      end_time: "3:00 PM",
      hours: 8,
    });
    expect(rows.map((r) => r.work_date)).not.toContain("2026-07-04"); // Saturday
  });

  it("stamps a materialised leave day with the booking that paid it", async () => {
    leaveRows = [
      {
        id: "lr-1",
        staff_profile_id: "me",
        kind: "annual",
        start_date: "2026-07-01",
        end_date: "2026-07-01",
        hours: 8,
        note: null,
        status: "approved",
        review_note: null,
        reviewed_by: null,
      },
    ];
    await submitWeek(MONDAY);
    const entryWrite = upsert.mock.calls.find(
      ([t, rows]) => t === "time_entries" && Array.isArray(rows),
    );
    const rows = entryWrite![1] as Record<string, unknown>[];
    const wednesday = rows.find((r) => r.work_date === "2026-07-01");
    // the booked day went down as leave, carrying its provenance
    expect(wednesday).toMatchObject({ kind: "leave", hours: 8, leave_request_id: "lr-1" });
    // an ordinary presumed day carries none
    const monday = rows.find((r) => r.work_date === "2026-06-29");
    expect(monday).toMatchObject({ kind: "work", leave_request_id: null });
  });

  it("resolves the holiday calendar through the org when the card has no state", async () => {
    /* The staff row this mock returns carries no `state`. Materialise must
       fall back to the organisation's state — pretending there are no
       holidays would write a public holiday down as a worked day. */
    await submitWeek(MONDAY);
    expect(holidayStateAsks).toContain("NSW");
  });

  it("writes the entries first, so a sheet is never sent ahead of its days", async () => {
    await submitWeek(MONDAY);
    const order = upsert.mock.calls.map(([t]) => t);
    expect(order.indexOf("time_entries")).toBeLessThan(order.indexOf("timesheets"));
  });

  it("writes nothing at all when the week is already closed", async () => {
    sheetStatus = "approved";
    expect((await submitWeek(MONDAY)).ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("your own normal hours", () => {
  it("needs no capability — an early start is not a pay decision", async () => {
    caps = new Set();
    const res = await saveMyHours("6:30 AM", "2:30 PM");
    expect(res).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith(
      "staff_profiles",
      expect.objectContaining({ default_start: "6:30 AM", default_end: "2:30 PM" }),
    );
  });

  it("clears back to the workspace's hours", async () => {
    await saveMyHours(null, null);
    expect(update).toHaveBeenCalledWith(
      "staff_profiles",
      expect.objectContaining({ default_start: null, default_end: null }),
    );
  });

  it("refuses half an override — it would presume against the org's other end", async () => {
    expect((await saveMyHours("6:30 AM", null)).ok).toBe(false);
    expect((await saveMyHours("half six", "2:30 PM")).ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("the period boundary belongs to the server", () => {
  it("refuses a period start the pay cycle would never produce", async () => {
    // A Wednesday. Its own sheet has no row, so before the guard it read as a
    // fresh editable draft — for saving, clearing, submitting and reviewing.
    expect((await saveDay("2026-07-01", 0, { t: "off" })).ok).toBe(false);
    expect((await saveDay("2026-07-01", 0, { t: "empty" })).ok).toBe(false);
    expect((await submitWeek("2026-07-01")).ok).toBe(false);
    expect((await approveWeek("target", "2026-07-01")).ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("can't reach an approved day through a forged offset period", async () => {
    // The week of Mon 22 Jun is approved and locked. A forged start of Thu 25
    // Jun with day 0 derives work_date 25 Jun — a day INSIDE that locked week
    // — while the forged period itself has no sheet row and reads as draft.
    sheetStatus = null;
    sheetStatusByPeriod = { "2026-06-22": "approved" };
    const res = await saveDay("2026-06-25", 0, { t: "work", in: "7:00 AM", out: "3:30 PM", h: 8 });
    expect(res.ok).toBe(false);
    expect((await submitWeek("2026-06-25")).ok).toBe(false);
    // and the straight-on write to the approved week stays refused too
    expect((await saveDay("2026-06-22", 0, { t: "off" })).ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("answers a garbage date with an error instead of throwing", async () => {
    for (const bad of ["never", "", "2026-02-31", "2026-6-2", "29/06/2026"]) {
      expect((await saveDay(bad, 0, { t: "off" })).ok).toBe(false);
      expect((await submitWeek(bad)).ok).toBe(false);
    }
    expect(upsert).not.toHaveBeenCalled();
  });

  it("refuses a fractional day index — it would land between grid columns", async () => {
    expect((await saveDay(MONDAY, 1.5, { t: "off" })).ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("review", () => {
  it("needs `approvals`", async () => {
    caps = new Set();
    expect((await approveWeek("target", MONDAY)).ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("refuses to let you approve your own timesheet", async () => {
    myStaffId = "target"; // the reviewer IS the target
    const res = await approveWeek("target", MONDAY);
    expect(res).toEqual({ ok: false, error: "You can't review your own timesheet." });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("refuses someone outside the org", async () => {
    staffExists = false;
    expect((await approveWeek("stranger", MONDAY)).ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("records who decided and when", async () => {
    await approveWeek("target", MONDAY);
    expect(upsert).toHaveBeenCalledWith(
      "timesheets",
      expect.objectContaining({ status: "approved", reviewed_by: "me", period_start: MONDAY }),
    );
  });

  it("won't send a sheet back without a reason", async () => {
    expect((await sendBackWeek("target", MONDAY, "   ")).ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();

    await sendBackWeek("target", MONDAY, "Confirm Tuesday's overtime");
    expect(upsert).toHaveBeenCalledWith(
      "timesheets",
      expect.objectContaining({ status: "sent_back", review_note: "Confirm Tuesday's overtime" }),
    );
  });
});

describe("pay settings", () => {
  it("need `financials` — they decide how everyone's pay is computed", async () => {
    caps = new Set(["approvals"]);
    expect((await savePaySettings(DEFAULT_SETTINGS)).ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();

    caps = new Set(["financials"]);
    expect((await savePaySettings(DEFAULT_SETTINGS)).ok).toBe(true);
    expect(upsert).toHaveBeenCalledWith("pay_settings", expect.objectContaining({ configured: true }));
  });
});
