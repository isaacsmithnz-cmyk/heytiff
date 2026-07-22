/* Time & Pay actions. Entry is intrinsic, review needs `approvals`, and a
   week that's gone for review is closed to its owner. */

const upsert = jest.fn().mockResolvedValue({ error: null });
const del = jest.fn();

let sheetStatus: string | null = "draft";
let staffExists = true;
let caps = new Set<string>(["approvals", "financials"]);
let myStaffId: string | null = "me";

const table = (name: string) => {
  const c: Record<string, unknown> = {};
  const self = () => c;
  c.eq = self;
  c.select = self;
  c.maybeSingle = async () => {
    if (name === "timesheets") return { data: sheetStatus ? { status: sheetStatus } : null };
    return { data: staffExists ? { id: "target" } : null };
  };
  c.upsert = (row: unknown) => {
    upsert(name, row);
    return Promise.resolve({ error: null });
  };
  c.delete = () => {
    del(name);
    return c;
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

import { approveWeek, saveDay, savePaySettings, sendBackWeek, submitWeek } from "../timepay";
import { DEFAULT_SETTINGS } from "@/components/timepay/logic";

const MONDAY = "2026-06-29";

beforeEach(() => {
  [upsert, del].forEach((m) => m.mockClear());
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
