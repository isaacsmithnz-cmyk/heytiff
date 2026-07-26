/* Time & Pay actions. Entry is intrinsic, review needs `approvals`, and a
   week that's gone for review is closed to its owner. */

const upsert = jest.fn().mockResolvedValue({ error: null });
const del = jest.fn();

let sheetStatus: string | null = "draft";
let staffExists = true;
let caps = new Set<string>(["approvals", "financials"]);
let myStaffId: string | null = "me";

const update = jest.fn();

/* A chainable query stub. Every filter/ordering method returns the builder, so
   a query can grow new clauses without this mock needing to learn them — which
   it had to twice already. Only the methods that END a chain, or that we
   assert on, are real. */
const table = (name: string) => {
  const c: Record<string, unknown> = {};
  /* Returns the PROXY, not the bare object — a chain that falls through to an
     unhandled method has to keep falling through on the next one too. */
  let proxy: Record<string, unknown>;
  const self = () => proxy;
  c.maybeSingle = async () => {
    if (name === "timesheets") return { data: sheetStatus ? { status: sheetStatus } : null };
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
  // testing here
  c.then = (res: (v: { error: null; data: never[] }) => unknown) =>
    Promise.resolve({ error: null, data: [] }).then(res);
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
  staffExists = true;
  caps = new Set(["approvals", "financials"]);
  myStaffId = "me";
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

  it("refuses a worked day with no times, and impossible hours", async () => {
    expect((await saveDay(MONDAY, 0, { t: "work", in: "", out: "", h: 8 })).ok).toBe(false);
    expect((await saveDay(MONDAY, 0, { t: "leave", h: 30 })).ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("refuses a day index outside the week", async () => {
    expect((await saveDay(MONDAY, 7, { t: "leave", h: 8 })).ok).toBe(false);
    expect((await saveDay(MONDAY, -1, { t: "leave", h: 8 })).ok).toBe(false);
  });

  it("locks the week once it's submitted, and again once approved", async () => {
    sheetStatus = "submitted";
    expect((await saveDay(MONDAY, 0, { t: "leave", h: 8 })).ok).toBe(false);
    sheetStatus = "approved";
    expect((await saveDay(MONDAY, 0, { t: "leave", h: 8 })).ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("reopens it when a manager sends it back", async () => {
    sheetStatus = "sent_back";
    expect((await saveDay(MONDAY, 0, { t: "leave", h: 8 })).ok).toBe(true);
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
