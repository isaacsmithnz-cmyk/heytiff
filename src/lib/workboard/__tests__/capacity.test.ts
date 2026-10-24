/* How full a day is. The promise this module makes is that a number on a cell
   is either true or absent — never invented to fill the space — so these tests
   are mostly about the cases where there is NO number, and about the ones
   where the number is bigger than 100. */

import {
  bookedMinutesOf,
  capacityForDay,
  daysBetweenISO,
  dowOfISO,
  isWorkingDayISO,
  type CapacityAllocation,
} from "../capacity";

const crew = (n: number, dailyMinutes = 480): CapacityAllocation[] =>
  Array.from({ length: n }, (_, i) => ({
    staffUuid: `s-${i}`,
    name: `Tech ${i}`,
    included: true,
    dailyMinutes,
  }));


describe("the calendar, without a Date in sight", () => {
  it("knows which day of the week an ISO date is", () => {
    expect(dowOfISO("2026-08-17")).toBe(0); // the Monday it counts from
    expect(dowOfISO("2026-08-21")).toBe(4); // Friday
    expect(dowOfISO("2026-08-22")).toBe(5); // Saturday
    expect(dowOfISO("2026-08-23")).toBe(6); // Sunday
    // and backwards over a month boundary, where a naive modulo goes negative
    expect(dowOfISO("2026-07-27")).toBe(0);
    expect(dowOfISO("2025-12-25")).toBe(3);
  });

  it("counts whole days in both directions, across months and years", () => {
    expect(daysBetweenISO("2026-08-17", "2026-08-24")).toBe(7);
    expect(daysBetweenISO("2026-08-24", "2026-08-17")).toBe(-7);
    expect(daysBetweenISO("2026-02-28", "2026-03-01")).toBe(1); // 2026 is not a leap year
    expect(daysBetweenISO("2024-02-28", "2024-03-01")).toBe(2); // 2024 is
    expect(daysBetweenISO("2025-12-31", "2026-01-01")).toBe(1);
  });

  it("counts Monday to Friday as the working week", () => {
    expect(isWorkingDayISO("2026-08-21")).toBe(true);
    expect(isWorkingDayISO("2026-08-22")).toBe(false);
    expect(isWorkingDayISO("2026-08-23")).toBe(false);
  });
});

describe("the denominator", () => {
  it("is the allocated crew's hours, not the people who happen to be booked", () => {
    // ten people at eight hours is Isaac's own example: eighty hours to give
    expect(capacityForDay("2026-08-21", crew(10))).toBe(10 * 480);
  });

  it("takes each person's OWN hours", () => {
    const mixed: CapacityAllocation[] = [
      { staffUuid: "a", name: "Full", included: true, dailyMinutes: 480 },
      { staffUuid: "b", name: "Part", included: true, dailyMinutes: 240 },
    ];
    expect(capacityForDay("2026-08-21", mixed)).toBe(720);
  });

  it("leaves out whoever is not in the index, without forgetting their hours", () => {
    /* The placeholder ServiceM8 parks work against is a staff row and is not a
       person; excluding it must not mean deleting what it was set to. */
    const withPlaceholder: CapacityAllocation[] = [
      ...crew(2),
      { staffUuid: "pending", name: "Pending Jobs", included: false, dailyMinutes: 480 },
    ];
    expect(capacityForDay("2026-08-21", withPlaceholder)).toBe(960);
  });

  it("is zero at a weekend, and zero when nobody is allocated", () => {
    expect(capacityForDay("2026-08-22", crew(10))).toBe(0);
    expect(capacityForDay("2026-08-21", [])).toBe(0);
    expect(capacityForDay("2026-08-21", crew(3).map((a) => ({ ...a, included: false })))).toBe(0);
  });

  it("refuses a negative day, rather than subtracting somebody from the crew", () => {
    const odd: CapacityAllocation[] = [
      ...crew(1),
      { staffUuid: "x", name: "Typo", included: true, dailyMinutes: -600 },
    ];
    expect(capacityForDay("2026-08-21", odd)).toBe(480);
  });
});

describe("the numerator", () => {
  it("measures a booking in minutes on its own day", () => {
    expect(bookedMinutesOf({ start: "2026-08-20 07:00:00", end: "2026-08-20 15:00:00" })).toBe(480);
    expect(bookedMinutesOf({ start: "2026-08-20 07:30:00", end: "2026-08-20 08:00:00" })).toBe(30);
  });

  it("gives a zero or reversed span the rail's own 30 minutes", () => {
    // it happened; it is not worth nothing, and it is certainly not negative
    expect(bookedMinutesOf({ start: "2026-08-20 07:00:00", end: "2026-08-20 07:00:00" })).toBe(30);
    expect(bookedMinutesOf({ start: "2026-08-20 09:00:00", end: "2026-08-20 08:00:00" })).toBe(30);
    expect(bookedMinutesOf({ start: "2026-08-20 09:00:00", end: null })).toBe(30);
  });

  it("stops a booking that crosses midnight at midnight", () => {
    /* A month total is a SUM of these. Wrapping would have this booking
       subtract fourteen hours from the day it started on. */
    expect(bookedMinutesOf({ start: "2026-08-20 22:00:00", end: "2026-08-21 06:00:00" })).toBe(120);
  });
});


