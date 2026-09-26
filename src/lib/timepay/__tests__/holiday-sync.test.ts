/* The lazy top-up. Insert-only via ignoreDuplicates, guard-first, rules-fed. */

const upsert = jest.fn().mockResolvedValue({ error: null });

/** What the guard query finds as the newest auto row, or null for none. */
let newestAuto: string | null = null;

const table = () => {
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.eq = () => c;
  c.order = () => c;
  c.limit = () => c;
  c.maybeSingle = () =>
    Promise.resolve({ data: newestAuto ? { holiday_date: newestAuto } : null, error: null });
  c.upsert = (rows: unknown, opts: unknown) => {
    upsert(rows, opts);
    return Promise.resolve({ error: null });
  };
  return c;
};

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: () => table() } }));

// deterministic rules so the test controls exactly what the sync would write
jest.mock("../holiday-rules", () => ({
  certainHolidays: jest.fn((state: string, year: number) =>
    state === "NSW"
      ? [
          { date: `${year}-01-01`, name: "New Year's Day" },
          { date: `${year}-12-25`, name: "Christmas Day" },
        ]
      : [],
  ),
}));

import { ensureHolidays, ENSURE_MIN_AHEAD_DAYS } from "../holiday-sync";
import { certainHolidays } from "../holiday-rules";
import { addDays } from "../period";

const TODAY = "2026-07-25";

beforeEach(() => {
  upsert.mockClear();
  (certainHolidays as jest.Mock).mockClear();
  newestAuto = null;
});

it("does nothing without a state", async () => {
  expect(await ensureHolidays("org-1", null, TODAY)).toBe(false);
  expect(upsert).not.toHaveBeenCalled();
  expect(certainHolidays).not.toHaveBeenCalled();
});

it("is a single cheap guard query when coverage is healthy", async () => {
  newestAuto = addDays(TODAY, ENSURE_MIN_AHEAD_DAYS + 30); // well past the threshold
  // and says it wrote nothing, so a reader beside it keeps what it read
  expect(await ensureHolidays("org-1", "NSW", TODAY)).toBe(false);
  expect(upsert).not.toHaveBeenCalled();
  expect(certainHolidays).not.toHaveBeenCalled();
});

it("fills from the current year to ~24 months out when coverage is thin", async () => {
  newestAuto = addDays(TODAY, 100); // under the threshold
  expect(await ensureHolidays("org-1", "NSW", TODAY)).toBe(true);

  expect(upsert).toHaveBeenCalledTimes(1);
  const [rows, opts] = upsert.mock.calls[0];

  // insert-only on the natural key — existing rows (manual, synced, or
  // suppressed tombstones) are never touched
  expect(opts).toEqual({ onConflict: "org_id,state,holiday_date", ignoreDuplicates: true });

  const dates = (rows as { holiday_date: string }[]).map((r) => r.holiday_date);
  // whole current year in (dates before today included), horizon respected
  expect(dates).toContain("2026-01-01");
  expect(dates).toContain("2027-12-25");
  // 2028-12-25 is past today+730 (2028-07-24) even though 2028 is generated
  expect(dates).toContain("2028-01-01");
  expect(dates).not.toContain("2028-12-25");

  for (const r of rows as Record<string, unknown>[]) {
    expect(r.org_id).toBe("org-1");
    expect(r.state).toBe("NSW");
    expect(r.source).toBe("auto");
    expect(r.suppressed).toBe(false);
  }
});

it("also fills when no auto rows exist at all, and says it wrote", async () => {
  newestAuto = null;
  expect(await ensureHolidays("org-1", "NSW", TODAY)).toBe(true);
  expect(upsert).toHaveBeenCalledTimes(1);
});

it("writes nothing for a state the rules don't cover yet, and says so", async () => {
  newestAuto = null;
  expect(await ensureHolidays("org-1", "WA", TODAY)).toBe(false);
  expect(certainHolidays).toHaveBeenCalled();
  expect(upsert).not.toHaveBeenCalled();
});
