/* Writing a submission down — the part the Submit button, the approver and a
   sheet that sends itself all share. The loader test mocks this module whole,
   so the writes themselves are pinned here. */

const upserts: { table: string; rows: unknown; opts: unknown }[] = [];
let failOn: string | null = null;

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      upsert: (rows: unknown, opts: unknown) => {
        upserts.push({ table, rows, opts });
        return Promise.resolve({ error: failOn === table ? { message: "refused" } : null });
      },
    }),
  },
}));
// the materialisation's readers — nothing below reaches them
jest.mock("../query", () => ({}));
jest.mock("../leave-query", () => ({}));
jest.mock("../presume", () => ({}));

import { momentInstant, rowsFor, sendThemselves, type Presumed } from "../submit";

/* Mon 20 – Fri 24 Jul: a presumed Monday, a Tuesday the person entered, a
   booked Wednesday, a public holiday Thursday, and an empty Friday. */
const presumed = {
  days: [
    { t: "work", in: "7:00 AM", out: "3:00 PM", h: 8 },
    { t: "work", in: "7:00 AM", out: "5:00 PM", h: 10 },
    { t: "leave", h: 8 },
    { t: "ph", h: 8 },
    { t: "empty" },
  ],
  sources: ["presumed", "entered", "leave", "holiday", "none"],
  absences: new Map([["2026-07-22", { id: "lr-9" }]]),
} as unknown as Presumed;

beforeEach(() => {
  upserts.length = 0;
  failOn = null;
});

describe("the rows a submission writes", () => {
  it("writes down what was filled in — never a day the person entered, never an empty one", () => {
    const rows = rowsFor("org-1", "me", "2026-07-20", presumed);
    expect(rows.map((r) => [r.work_date, r.kind, r.hours, r.leave_request_id])).toEqual([
      ["2026-07-20", "work", 8, null],
      // a booked day carries the request that paid it
      ["2026-07-22", "leave", 8, "lr-9"],
      ["2026-07-23", "ph", 8, null],
    ]);
  });
});

describe("a sheet that sends itself", () => {
  const sent = [{ staffId: "me", presumed }];

  it("writes its days before the sheet, so a sheet never goes ahead of its days", async () => {
    expect(await sendThemselves("org-1", "2026-07-20", sent, "2026-07-26T05:00:00.000Z")).toBe(true);
    expect(upserts.map((u) => u.table)).toEqual(["time_entries", "timesheets"]);
    expect(upserts[1].rows).toEqual([
      expect.objectContaining({
        staff_profile_id: "me",
        period_start: "2026-07-20",
        status: "submitted",
        submitted_at: "2026-07-26T05:00:00.000Z",
        review_note: null,
      }),
    ]);
  });

  /* The loader read these sheets as drafts and these days as unwritten a
     moment ago. An approver deciding, or a person saving a day, in between
     must not be overwritten by the presumption: both writes only fill gaps. */
  it("never overwrites a row that exists by the time it writes", async () => {
    await sendThemselves("org-1", "2026-07-20", sent, "2026-07-26T05:00:00.000Z");
    expect(upserts).toHaveLength(2);
    for (const u of upserts) expect(u.opts).toMatchObject({ ignoreDuplicates: true });
  });

  it("says so when a write didn't land, and never sends a sheet whose days didn't", async () => {
    failOn = "time_entries";
    expect(await sendThemselves("org-1", "2026-07-20", sent, "2026-07-26T05:00:00.000Z")).toBe(false);
    expect(upserts.map((u) => u.table)).toEqual(["time_entries"]);

    upserts.length = 0;
    failOn = "timesheets";
    expect(await sendThemselves("org-1", "2026-07-20", sent, "2026-07-26T05:00:00.000Z")).toBe(false);
  });

  it("does nothing when nobody is due", async () => {
    expect(await sendThemselves("org-1", "2026-07-20", [], "2026-07-26T05:00:00.000Z")).toBe(true);
    expect(upserts).toHaveLength(0);
  });
});

describe("when a sheet that sent itself says it went", () => {
  it("records the moment, on the AU clock, not when somebody next looked", () => {
    // Sun 6 Sep 2026, 3:00 PM AEST (UTC+10)
    expect(momentInstant({ date: "2026-09-06", minutes: 15 * 60 }, { submitTime: "3:00 PM" })).toBe(
      "2026-09-06T05:00:00.000Z",
    );
    // Sun 6 Dec 2026, 3:00 PM AEDT (UTC+11) — daylight saving moves the instant, not the wall clock
    expect(momentInstant({ date: "2026-12-06", minutes: 15 * 60 }, { submitTime: "3:00 PM" })).toBe(
      "2026-12-06T04:00:00.000Z",
    );
  });
});
