/* The job sheet's "Next on site" line. ServiceM8's activity feed mixes two
   kinds of row under one table: activity_was_scheduled=1 is a dispatched
   booking, =0 is a recorded time-on-site session. Seen live on job #3188
   (2026-08-14): the sheet said "Next on site 10:15am–12:13pm" — a recording,
   note the 12:13 end — while the actual booking that day was 11:30am–2pm.
   Only scheduled rows may become the next booking; recorded rows feed the
   time-on-site sum and nothing else. */

const rowsBy: Record<string, Record<string, unknown>[]> = {};
const singleBy: Record<string, Record<string, unknown> | null> = {};

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const sub: Record<string, unknown> = {};
      sub.select = () => sub;
      sub.eq = () => sub;
      sub.in = () => sub;
      sub.order = () => sub;
      sub.limit = () => sub;
      sub.maybeSingle = () => Promise.resolve({ data: singleBy[table] ?? null });
      sub.then = (res: (v: { data: unknown[] }) => unknown) =>
        Promise.resolve({ data: rowsBy[table] ?? [] }).then(res);
      return sub;
    },
  },
}));

import { readMirrorJobDetail } from "@/lib/workboard/all-jobs-query";

const TODAY = "2026-08-14";

const jobRow = {
  uuid: "j-3188",
  generated_job_id: "3188",
  status: "Work Order",
  company_uuid: null,
  job_address: null,
  geo_city: null,
  geo_state: null,
  geo_postcode: null,
  category_uuid: null,
  queue_uuid: null,
  queue_expiry_date: null,
  queue_assigned_staff_uuid: null,
  job_description: "Split not cooling",
  work_done_description: null,
  purchase_order_number: null,
  date: "2026-08-10 08:00:00",
  quote_date: null,
  work_order_date: null,
  completion_date: null,
};

/* Rows arrive ordered by start_date ascending, as the query asks. */
const recorded = {
  start_date: "2026-08-14 10:15:00",
  end_date: "2026-08-14 12:13:00",
  staff_uuid: null,
  activity_was_scheduled: 0,
};
const booked = {
  start_date: "2026-08-14 11:30:00",
  end_date: "2026-08-14 14:00:00",
  staff_uuid: null,
  activity_was_scheduled: 1,
};

beforeEach(() => {
  for (const k of Object.keys(rowsBy)) delete rowsBy[k];
  for (const k of Object.keys(singleBy)) delete singleBy[k];
  singleBy["sm8_jobs"] = jobRow;
});

describe("next booking comes only from scheduled rows", () => {
  it("skips a recorded session earlier today when the real booking sits after it", async () => {
    rowsBy["sm8_job_activities"] = [recorded, booked];

    const detail = await readMirrorJobDetail("org-1", "j-3188", TODAY, {
      includeMoney: false,
    });

    // The dispatched 11:30–2pm block, not the 10:15–12:13 recording.
    expect(detail?.nextBooking).toEqual({
      start: "2026-08-14 11:30:00",
      end: "2026-08-14 14:00:00",
      staffName: null,
    });

    // The recording still counts where it belongs: time on site.
    expect(detail?.timeOnSite).toEqual({ minutes: 118, sessions: 1 });
  });

  it("shows no booking at all when only recordings exist ahead of now", async () => {
    rowsBy["sm8_job_activities"] = [recorded];

    const detail = await readMirrorJobDetail("org-1", "j-3188", TODAY, {
      includeMoney: false,
    });

    expect(detail?.nextBooking).toBeNull();
    expect(detail?.timeOnSite).toEqual({ minutes: 118, sessions: 1 });
  });
});
