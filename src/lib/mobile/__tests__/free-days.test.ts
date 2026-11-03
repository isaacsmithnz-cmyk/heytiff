/**
 * @jest-environment node
 */

/* Someone's days, free and booked, for moving a visit to another day: the
   gaps in their normal day around their bookings and their time off, today
   from now, and a gap next to a booking in the job's own suburb offered
   first (Isaac, 2 November 2026: "there's no way of telling you before you
   make the booking"). */


import { placeDays } from "../free-days-plan";

const MOSMAN = "job-3469";
const CREMORNE = "job-3375";
const MOVING = "job-3488";
const jobs = new Map([
  [MOSMAN, { number: "3469", suburb: "Mosman", colour: null, status: "Work Order" }],
  [CREMORNE, { number: "3375", suburb: "Cremorne", colour: "#B45309", status: "Work Order" }],
  [MOVING, { number: "3488", suburb: "Mosman", colour: null, status: "Quote" }],
]);
const normal = { startMin: 7 * 60, endMin: 15 * 60 };
const at = (d: string, hhmm: string) => `${d} ${hhmm}:00`;
const FRI = "2026-11-06";
const SAT = "2026-11-07";
const noneOff = () => ({ spans: [] });

test("a day's gaps sit around its bookings, inside the normal day, with its suburbs", () => {
  const { days } = placeDays({
    days: [FRI],
    normal,
    workDays: [0, 1, 2, 3, 4],
    bookings: [
      { activity: "a1", jobUuid: CREMORNE, start: at(FRI, "07:00"), end: at(FRI, "09:00") },
      { activity: "a2", jobUuid: MOSMAN, start: at(FRI, "11:00"), end: at(FRI, "12:00") },
    ],
    jobs,
    away: noneOff,
    now: null,
    minutes: 60,
    job: MOVING,
  });
  expect(days).toHaveLength(1);
  expect(days[0]).toMatchObject({
    day: FRI,
    work: true,
    free: [
      { start: at(FRI, "09:00"), end: at(FRI, "11:00") },
      { start: at(FRI, "12:00"), end: at(FRI, "15:00") },
    ],
    freeMin: 300,
    off: null,
    suburbs: ["Cremorne", "Mosman"],
  });
  expect(days[0]!.bookings.map((b) => [b.number, b.suburb])).toEqual([
    ["3375", "Cremorne"],
    ["3469", "Mosman"],
  ]);
});

test("close by is the gap right after a booking in the job's suburb, the visit's length long", () => {
  const { near } = placeDays({
    days: [FRI],
    normal,
    workDays: [0, 1, 2, 3, 4],
    bookings: [
      { activity: "a1", jobUuid: CREMORNE, start: at(FRI, "07:00"), end: at(FRI, "09:00") },
      { activity: "a2", jobUuid: MOSMAN, start: at(FRI, "11:00"), end: at(FRI, "12:00") },
    ],
    jobs,
    away: noneOff,
    now: null,
    minutes: 60,
    job: MOVING,
  });
  /* 9:00 to 11:00 is before 3469 in Mosman too; the first that fits wins */
  expect(near).toEqual([
    { day: FRI, start: at(FRI, "10:00"), end: at(FRI, "11:00"), next: "before", number: "3469", suburb: "Mosman" },
    { day: FRI, start: at(FRI, "12:00"), end: at(FRI, "13:00"), next: "after", number: "3469", suburb: "Mosman" },
  ]);
});

test("today starts from now, to the quarter hour after it; a day gone is left out", () => {
  const { days } = placeDays({
    days: ["2026-11-05", FRI],
    normal,
    workDays: [0, 1, 2, 3, 4],
    bookings: [],
    jobs,
    away: noneOff,
    now: at(FRI, "10:07"),
    minutes: null,
    job: null,
  });
  expect(days.map((d) => d.day)).toEqual([FRI]);
  expect(days[0]!.free).toEqual([{ start: at(FRI, "10:15"), end: at(FRI, "15:00") }]);
});

test("time off takes its part of the day, and a whole day of it says what it is", () => {
  const { days } = placeDays({
    days: ["2026-11-05", FRI],
    normal,
    workDays: [0, 1, 2, 3, 4],
    bookings: [],
    jobs,
    away: (d) => ({
      spans: d === FRI ? [{ startMin: 0, endMin: 24 * 60, whole: true, word: "Annual Leave" }] : [{ startMin: 12 * 60, endMin: 24 * 60, whole: false, word: "Dentist" }],
    }),
    now: null,
    minutes: null,
    job: null,
  });
  expect(days[0]).toMatchObject({ free: [{ start: at("2026-11-05", "07:00"), end: at("2026-11-05", "12:00") }], off: null });
  expect(days[1]).toMatchObject({ free: [], freeMin: 0, off: "Annual Leave" });
});

test("a day off the roster is still listed, as ServiceM8 still books it; a sliver under half an hour isn't free", () => {
  const { days } = placeDays({
    days: [SAT],
    normal,
    workDays: [0, 1, 2, 3, 4],
    bookings: [{ activity: "a1", jobUuid: CREMORNE, start: at(SAT, "07:20"), end: at(SAT, "15:00") }],
    jobs,
    away: noneOff,
    now: null,
    minutes: null,
    job: null,
  });
  expect(days[0]).toMatchObject({ work: false, free: [], freeMin: 0 });
});
