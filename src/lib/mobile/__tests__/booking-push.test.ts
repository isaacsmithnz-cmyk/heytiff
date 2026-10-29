/**
 * @jest-environment node
 */
/* Your schedule changed (lib/mobile/booking-push): what a person is told,
   drawn on 29 October 2026, when 1352's bookings for Isaac, Dave and Alex M
   were taken off at 11:58 and Alex rebooked alone at 12:00. */
jest.mock("server-only", () => ({}));
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));
jest.mock("@/lib/integrations/sm8-booking-zone", () => ({}));
jest.mock("@/lib/integrations/links", () => ({}));
jest.mock("@/lib/mobile/push", () => ({}));
jest.mock("@/lib/mobile/clock", () => ({ wallMinute: () => null }));

import { bookingChanges, changeMessage, whenWords, type Booking } from "@/lib/mobile/booking-push";

const W = { from: "2026-10-29 00:00:00", until: "2026-11-12 23:59:59", editedSince: "2026-10-28 12:00:00" };
const act = (over: Partial<Booking>): Booking => ({
  uuid: "a1",
  job_uuid: "J1352",
  staff_uuid: "ISAAC",
  start_date: "2026-10-29 07:00:00",
  end_date: "2026-10-29 15:30:00",
  activity_was_scheduled: 1,
  active: 1,
  edit_date: "2026-10-29 11:58:46",
  ...over,
});

test("a booking taken off, one moved, one added: each its person's", () => {
  const before = new Map([
    ["a1", act({ uuid: "a1" })],
    ["a2", act({ uuid: "a2", staff_uuid: "ALEX", start_date: "2026-10-30 07:00:00" })],
  ]);
  const after = [
    act({ uuid: "a1", active: 0 }),
    act({ uuid: "a2", staff_uuid: "ALEX", start_date: "2026-10-30 09:00:00", end_date: "2026-10-30 15:00:00" }),
    act({ uuid: "a3", staff_uuid: "DAVE", start_date: "2026-11-02 07:00:00", edit_date: "2026-10-29 12:00:17" }),
  ];
  expect(bookingChanges(before, after, W)).toEqual([
    { uuid: "a1", staffUuid: "isaac", jobUuid: "j1352", kind: "gone", start: "2026-10-29 07:00:00" },
    { uuid: "a2", staffUuid: "alex", jobUuid: "j1352", kind: "moved", start: "2026-10-30 09:00:00" },
    { uuid: "a3", staffUuid: "dave", jobUuid: "j1352", kind: "new", start: "2026-11-02 07:00:00" },
  ]);
});

test("handed to someone else: gone for one, new for the other", () => {
  const before = new Map([["a1", act({})]]);
  expect(bookingChanges(before, [act({ staff_uuid: "ALEX" })], W).map((c) => [c.staffUuid, c.kind])).toEqual([
    ["isaac", "gone"],
    ["alex", "new"],
  ]);
});

test("nothing is said of check-ins, the past, beyond a fortnight, an unchanged booking, or an old edit", () => {
  const before = new Map([["a1", act({})]]);
  expect(bookingChanges(new Map(), [act({ activity_was_scheduled: 0 })], W)).toEqual([]);
  expect(bookingChanges(new Map(), [act({ start_date: "2026-10-28 07:00:00" })], W)).toEqual([]);
  expect(bookingChanges(new Map(), [act({ start_date: "2026-12-01 07:00:00" })], W)).toEqual([]);
  expect(bookingChanges(before, [act({})], W)).toEqual([]);
  expect(bookingChanges(new Map(), [act({ edit_date: "2026-10-20 09:00:00" })], W)).toEqual([]);
});

test("the words: one change whole, several counted", () => {
  expect(whenWords("2026-11-02 07:00:00")).toBe("Mon 2 Nov, 7:00 am");
  expect(whenWords("2026-10-30 13:30:00")).toBe("Fri 30 Oct, 1:30 pm");
  const name = () => "1352, 9/6 Holbrook Avenue";
  expect(changeMessage([{ uuid: "a", staffUuid: "s", jobUuid: "j", kind: "moved", start: "2026-10-30 09:00:00" }], name)).toEqual({
    title: "Booking moved",
    body: "1352, 9/6 Holbrook Avenue moved to Fri 30 Oct, 9:00 am",
  });
  const three = (["new", "gone", "moved"] as const).map((kind, i) => ({ uuid: String(i), staffUuid: "s", jobUuid: "j", kind, start: "2026-11-02 07:00:00" }));
  expect(changeMessage(three, name)).toEqual({
    title: "Your schedule changed: 3 bookings",
    body: "1352, 9/6 Holbrook Avenue, Mon 2 Nov, 7:00 am. 1352, 9/6 Holbrook Avenue, Mon 2 Nov, 7:00 am, taken off (and 1 more)",
  });
});
