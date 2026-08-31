/* How full a day is. The promise this module makes is that a number on a cell
   is either true or absent — never invented to fill the space — so these tests
   are mostly about the cases where there is NO number, and about the ones
   where the number is bigger than 100. */

import {
  bookedMinutesOf,
  capacityForDay,
  capacityMonth,
  capacityMonthTotal,
  daysBetweenISO,
  daysOfMonth,
  dowOfISO,
  isWorkingDayISO,
  type CapacityAllocation,
} from "../capacity";
import type { ScheduleActivity } from "../schedule";

const crew = (n: number, dailyMinutes = 480): CapacityAllocation[] =>
  Array.from({ length: n }, (_, i) => ({
    staffUuid: `s-${i}`,
    name: `Tech ${i}`,
    included: true,
    dailyMinutes,
  }));

const booking = (over: Partial<ScheduleActivity> = {}): ScheduleActivity => ({
  uuid: `a-${Math.random()}`,
  jobUuid: "j-1",
  staffUuid: "s-0",
  start: "2026-08-20 07:00:00",
  end: "2026-08-20 15:00:00",
  wasScheduled: 1,
  ...over,
});

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

  it("lays out a month, however long it is", () => {
    expect(daysOfMonth("2026-08-20")).toHaveLength(31);
    expect(daysOfMonth("2026-09-01")).toHaveLength(30);
    expect(daysOfMonth("2026-02-14")).toHaveLength(28);
    expect(daysOfMonth("2024-02-14")).toHaveLength(29);
    expect(daysOfMonth("2026-08-20")[0]).toBe("2026-08-01");
    expect(daysOfMonth("2026-08-20")[30]).toBe("2026-08-31");
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

describe("a scored month", () => {
  const monthOf = (activities: ScheduleActivity[], allocation = crew(10)) => capacityMonth({ anyDayISO: "2026-08-20", activities, allocation });

  it("scores a working day against the allocated crew", () => {
    // 40h of the 80h ten people can give is Isaac's fifty per cent
    const five = Array.from({ length: 5 }, (_, i) =>
      booking({ staffUuid: `s-${i}`, jobUuid: `j-${i}` })
    );
    const day = monthOf(five).find((d) => d.dayISO === "2026-08-20")!;
    expect(day.bookedMinutes).toBe(5 * 480);
    expect(day.capacityMinutes).toBe(10 * 480);
    expect(day.fillPct).toBe(50);
    expect(day.over).toBe(false);
    expect(day.bookings).toBe(5);
    expect(day.jobs).toBe(5);
  });

  it("counts a crew job once as a job and many times as hours", () => {
    /* Three people on one eight-hour job consume twenty-four hours of the
       day's capacity, and it is still one job. Both numbers are true and the
       cell says both. */
    const crewJob = ["s-0", "s-1", "s-2"].map((staffUuid) => booking({ staffUuid, jobUuid: "j-9" }));
    const day = monthOf(crewJob).find((d) => d.dayISO === "2026-08-20")!;
    expect(day.jobs).toBe(1);
    expect(day.bookings).toBe(3);
    expect(day.bookedMinutes).toBe(3 * 480);
  });

  it("HAS NO SCORE at a weekend, rather than dividing by zero", () => {
    const sat = monthOf([booking({ start: "2026-08-22 08:00:00", end: "2026-08-22 12:00:00" })]).find(
      (d) => d.dayISO === "2026-08-22"
    )!;
    expect(sat.bookedMinutes).toBe(240); // the hours are still reported
    expect(sat.capacityMinutes).toBe(0);
    expect(sat.fillPct).toBeNull();
    expect(sat.over).toBe(false); // a day with no capacity cannot be over it
  });

  it("has no score at all when nobody is allocated", () => {
    // the empty index is the first thing a new account has, and it must not
    // paint thirty-one cells of 0% as though the crew were idle
    for (const d of monthOf([booking()], [])) {
      expect(d.fillPct).toBeNull();
      expect(d.over).toBe(false);
    }
  });

  it("counts minutes belonging to people OUTSIDE the index, and goes over", () => {
    /* An apprentice nobody allocated still consumes the day. Hiding those
       hours would make the board lie in the comfortable direction. */
    const two = crew(1); // one person, 8h of capacity
    const day = capacityMonth({
      anyDayISO: "2026-08-20",
      allocation: two,
      activities: [booking({ staffUuid: "s-0" }), booking({ staffUuid: "nobody-allocated" })],
    }).find((d) => d.dayISO === "2026-08-20")!;
    expect(day.bookedMinutes).toBe(960);
    expect(day.capacityMinutes).toBe(480);
    expect(day.fillPct).toBe(200);
    expect(day.over).toBe(true);
  });

  it("draws only dispatched bookings, exactly as the rail does", () => {
    // `= 0` is recorded time on site and OVERLAPS the booked hour on the same
    // job — counting both would double the day
    const day = monthOf([booking(), booking({ wasScheduled: 0 })]).find(
      (d) => d.dayISO === "2026-08-20"
    )!;
    expect(day.bookings).toBe(1);
    expect(day.bookedMinutes).toBe(480);
  });

  it("returns every day of the month, including the empty ones", () => {
    const days = monthOf([booking()]);
    expect(days).toHaveLength(31);
    const quiet = days.find((d) => d.dayISO === "2026-08-25")!;
    expect(quiet.bookedMinutes).toBe(0);
    expect(quiet.fillPct).toBe(0); // a working day with nothing on IS zero per cent
  });

  it("names the people on a day, and says so when a booking has nobody", () => {
    const day = capacityMonth({
      anyDayISO: "2026-08-20",
      allocation: crew(2),
      staffNames: new Map([["s-0", "Alex Lorenz"]]),
      activities: [booking({ staffUuid: "s-0" }), booking({ staffUuid: null })],
    }).find((d) => d.dayISO === "2026-08-20")!;
    expect(day.people).toEqual(["Alex Lorenz", "Nobody named"]);
  });
});

describe("the month's own line", () => {
  it("counts only days that have a denominator", () => {
    /* Otherwise a month reads emptier the more weekends it contains, which
       says nothing at all about the crew. */
    const days = capacityMonth({
      anyDayISO: "2026-08-20",
      allocation: crew(1),
      activities: [
        booking({ start: "2026-08-20 07:00:00", end: "2026-08-20 11:00:00" }), // Thu, 4h
        booking({ start: "2026-08-22 07:00:00", end: "2026-08-22 15:00:00" }), // Sat, 8h
      ],
    });
    const total = capacityMonthTotal(days);
    expect(total.workingDays).toBe(21); // August 2026 has 21 weekdays
    expect(total.bookedMinutes).toBe(240); // the Saturday's 8h is not in the score
    expect(total.capacityMinutes).toBe(21 * 480);
    expect(total.fillPct).toBe(2);
  });

  it("has no line to draw when nobody is allocated", () => {
    const days = capacityMonth({ anyDayISO: "2026-08-20", allocation: [], activities: [booking()] });
    expect(capacityMonthTotal(days).fillPct).toBeNull();
    expect(capacityMonthTotal(days).workingDays).toBe(0);
  });
});
