/**
 * @jest-environment node
 */

/* A job's money on the phone: the option the client took or the only one,
   its lines at cost by kind; each person's counted hours, a check-in left on
   counted out; an hour costed at the card's wage plus super. Drawn on 3372,
   the 14 kW Daikin ducted changeover (29 October 2026): 44 h allowed, Leo
   8 h 45 m on 16 October, three check-ins left on. */

jest.mock("server-only", () => ({}));
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));
jest.mock("@/lib/workboard/all-jobs-query", () => ({}));
jest.mock("@/lib/workboard/job-check-ins-server", () => ({}));
jest.mock("@/lib/workboard/query", () => ({}));
jest.mock("@/lib/integrations/links", () => ({}));
jest.mock("@/lib/quotes/lines-server", () => ({}));
jest.mock("@/lib/timepay/query", () => ({}));
jest.mock("@/lib/staff/my-pay", () => ({ DEFAULT_SUPER_PCT: 12 }));

import { allowedOf, exGstOf, hourCostCents, pickOption, workedOf } from "@/lib/mobile/job-money";
import type { QuoteLine } from "@/lib/quotes/lines";

const line = (optionIndex: number, kind: QuoteLine["kind"], qty: number, costCents: number) => ({ optionIndex, kind, qty, costCents }) as QuoteLine;

test("the option the client took, else the only one, else none", () => {
  expect(pickOption([1], [0, 1, 2])).toBe(1);
  expect(pickOption([], [2, 2, 2])).toBe(2);
  expect(pickOption([], [0, 1])).toBeNull();
  expect(pickOption([5], [0])).toBe(0);
});

test("an option's lines at cost, by kind; a labour line's quantity is hours", () => {
  const lines = [line(0, "unit", 1, 434140), line(0, "material", 2, 50000), line(0, "material", 30, 8601.1), line(0, "labour", 44, 11200), line(1, "unit", 1, 999999)];
  expect(allowedOf(lines, 0, "Option 1")).toEqual({ option: "Option 1", unitsCents: 434140, materialsCents: 358033, materialLines: 2, labourHours: 44, labourCents: 492800 });
});

test("each person's counted hours, day by day; a check-in left on is counted out", () => {
  const s = (staff: string, start: string, end: string) => ({ staff_uuid: staff, start_date: start, end_date: end, activity_was_scheduled: 0 });
  const { people, leftOn } = workedOf(
    [
      s("A1B2C3D4-0000-0000-0000-00000000001E", "2026-10-16 07:17:00", "2026-10-16 16:02:00"),
      s("luke", "2026-10-06 13:32:00", "2026-10-06 14:42:00"),
      s("luke", "2026-10-07 07:00:00", "2026-10-08 06:00:00"),
      { staff_uuid: "a1b2c3d4-0000-0000-0000-00000000001e", start_date: "2026-10-16 07:00:00", end_date: "2026-10-16 15:00:00", activity_was_scheduled: 1 },
    ],
    (k) => ({ "a1b2c3d4-0000-0000-0000-00000000001e": "Leo Watanangura", luke: "Luke Ingold" })[k] ?? "Someone",
    (k) => (k === "a1b2c3d4-0000-0000-0000-00000000001e" ? 6720 : null),
  );
  expect(leftOn).toBe(1);
  expect(people.map((p) => [p.name, p.minutes, p.costCents])).toEqual([
    ["Leo Watanangura", 525, 58800],
    ["Luke Ingold", 70, null],
  ]);
  expect(people[0]!.days).toEqual([{ day: "2026-10-16", from: "2026-10-16 07:17:00", until: "2026-10-16 16:02:00", minutes: 525 }]);
});

test("an hour costs the wage plus super; no wage, no cost", () => {
  expect(hourCostCents(60, 12)).toBe(6720);
  expect(hourCostCents(null, 12)).toBeNull();
  expect(hourCostCents(0, 12)).toBeNull();
});

test("quoted ex GST is ServiceM8's own lines added up, never worked out", () => {
  expect(exGstOf([{ exLineCents: 1000000 }, { exLineCents: 200000 }])).toBe(1200000);
  expect(exGstOf([{ exLineCents: 1000000 }, { exLineCents: null }])).toBeNull();
  expect(exGstOf([])).toBeNull();
});
