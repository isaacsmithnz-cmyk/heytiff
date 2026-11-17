import { bookedVisits } from "../built-from";

/* 3408 (the walk of 16 November 2026): two bookings for Isaac, no check-in;
   his photos and a note during the first, nothing from him in the second */
const ISAAC = "isaac";
const LUKE = "luke";
const acts = [
  { start_date: "2026-10-14 08:30:00", end_date: "2026-10-14 09:30:00", staff_uuid: ISAAC, activity_was_scheduled: 1 },
  { start_date: "2026-11-11 15:30:00", end_date: "2026-11-11 16:30:00", staff_uuid: ISAAC, activity_was_scheduled: 1 },
];
const marks = [
  { by: ISAAC, at: "2026-10-14 09:00:08" },
  { by: ISAAC, at: "2026-10-14 09:00:41" },
  { by: LUKE, at: "2026-11-11 15:58:00" },
  { by: ISAAC, at: "2026-11-11 22:31:00" },
];

it("counts a booking its person left photos or notes in, and not one they didn't", () => {
  expect(bookedVisits(acts, marks, "2026-11-17")).toEqual([{ day: "2026-10-14", staffId: ISAAC, minutes: 60 }]);
});

it("never counts someone else's photo in the booking", () => {
  expect(bookedVisits(acts.slice(1), [{ by: LUKE, at: "2026-11-11 16:00:00" }], "2026-11-17")).toEqual([]);
});

it("leaves the day to a check-in where that person checked in", () => {
  const checkedIn = [...acts, { start_date: "2026-10-14 08:40:00", end_date: "2026-10-14 09:20:00", staff_uuid: ISAAC, activity_was_scheduled: 0 }];
  expect(bookedVisits(checkedIn, marks, "2026-11-17")).toEqual([]);
});

it("counts nothing from today on", () => {
  expect(bookedVisits(acts, marks, "2026-10-14")).toEqual([]);
});
