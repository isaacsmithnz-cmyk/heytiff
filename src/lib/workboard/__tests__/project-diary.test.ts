/* The project diary — bookings-as-visits, pinned on job 279's real shapes:
   several crew booked one day, check-ins beside bookings on the same day, a
   check-in with no clock-off, and one session that ran past midnight. */

import {
  buildProjectDiary,
  mergeProjectDiary,
  tripDay,
  type DiaryActivityRow,
  type MergeTrip,
} from "@/lib/workboard/project-diary";

const staff = new Map<string, { name: string; title: string | null }>([
  ["s-alex", { name: "Alex Morozoff", title: "HVAC" }],
  ["s-cal", { name: "Callum Vrieze", title: "Apprentice" }],
  ["s-dave", { name: "David Hann", title: null }],
]);

const row = (over: Partial<DiaryActivityRow>): DiaryActivityRow => ({
  start_date: null,
  end_date: null,
  staff_uuid: null,
  activity_was_scheduled: 1,
  ...over,
});

describe("buildProjectDiary", () => {
  it("groups bookings by day, crew deduped by id, window spanning the crew", () => {
    const days = buildProjectDiary(
      [
        row({ start_date: "2026-03-04 07:00:00", end_date: "2026-03-04 15:00:00", staff_uuid: "s-alex" }),
        row({ start_date: "2026-03-04 07:00:00", end_date: "2026-03-04 15:00:00", staff_uuid: "s-cal" }),
        // the same person double-booked on the day stays ONE name
        row({ start_date: "2026-03-04 11:00:00", end_date: "2026-03-04 15:15:00", staff_uuid: "s-cal" }),
      ],
      staff
    );
    expect(days).toHaveLength(1);
    expect(days[0].day).toBe("2026-03-04");
    expect(days[0].booked.map((p) => p.name)).toEqual(["Alex Morozoff", "Callum Vrieze"]);
    expect(days[0].bookedStart).toBe("2026-03-04 07:00:00");
    expect(days[0].bookedEnd).toBe("2026-03-04 15:15:00");
    expect(days[0].sessionMinutes).toBe(0);
  });

  it("check-ins carry the minutes and the crew who actually turned up", () => {
    const days = buildProjectDiary(
      [
        row({ start_date: "2026-03-05 07:00:00", end_date: "2026-03-05 15:00:00", staff_uuid: "s-alex" }),
        row({
          start_date: "2026-03-05 07:01:55",
          end_date: "2026-03-05 09:15:19",
          staff_uuid: "s-cal",
          activity_was_scheduled: 0,
        }),
        row({
          start_date: "2026-03-05 09:36:46",
          end_date: "2026-03-05 10:51:49",
          staff_uuid: "s-cal",
          activity_was_scheduled: 0,
        }),
      ],
      staff
    );
    expect(days).toHaveLength(1);
    // 133 + 75 minutes, two sessions, one person
    expect(days[0].sessionMinutes).toBe(133 + 75);
    expect(days[0].sessionCrew.map((p) => p.name)).toEqual(["Callum Vrieze"]);
    expect(days[0].booked.map((p) => p.name)).toEqual(["Alex Morozoff"]);
  });

  it("a check-in with no clock-off proves presence but adds no minutes", () => {
    const days = buildProjectDiary(
      [
        row({
          start_date: "2026-03-04 08:58:57",
          end_date: null,
          staff_uuid: "s-alex",
          activity_was_scheduled: 0,
        }),
      ],
      staff
    );
    expect(days[0].sessionCrew.map((p) => p.name)).toEqual(["Alex Morozoff"]);
    expect(days[0].sessionMinutes).toBe(0);
  });

  it("a session past midnight states what the mirror recorded — no clamping", () => {
    const days = buildProjectDiary(
      [
        row({
          start_date: "2025-12-19 06:50:40",
          end_date: "2025-12-20 05:59:44",
          staff_uuid: "s-dave",
          activity_was_scheduled: 0,
        }),
      ],
      staff
    );
    // it lands on the day it STARTED, minutes as recorded (~23h)
    expect(days[0].day).toBe("2025-12-19");
    expect(days[0].sessionMinutes).toBe(1389);
  });

  it("an unknown staff uuid still shows up rather than vanishing the booking", () => {
    const days = buildProjectDiary(
      [row({ start_date: "2026-03-04 07:00:00", end_date: "2026-03-04 15:00:00", staff_uuid: "s-ghost" })],
      staff
    );
    expect(days[0].booked.map((p) => p.name)).toEqual(["Somebody"]);
  });

  it("days come back in date order regardless of input order", () => {
    const days = buildProjectDiary(
      [
        row({ start_date: "2026-04-10 07:30:00", end_date: "2026-04-10 15:00:00", staff_uuid: "s-alex" }),
        row({ start_date: "2026-03-04 07:00:00", end_date: "2026-03-04 15:00:00", staff_uuid: "s-cal" }),
      ],
      staff
    );
    expect(days.map((d) => d.day)).toEqual(["2026-03-04", "2026-04-10"]);
  });
});

describe("mergeProjectDiary", () => {
  const trip = (over: Partial<MergeTrip> & { id: string }): MergeTrip => ({
    status: "upcoming",
    bookedDate: null,
    completedAt: null,
    dueDate: "2026-09-01",
    ...over,
  });
  const diaryDay = (day: string) => ({
    day,
    booked: [],
    bookedStart: null,
    bookedEnd: null,
    sessionMinutes: 0,
    sessionCrew: [],
  });

  it("a trip booked on a diary day takes that day's reading — one row, not two", () => {
    const merged = mergeProjectDiary(
      [trip({ id: "t-1", bookedDate: "2026-09-03", status: "booked" })],
      [diaryDay("2026-09-03")],
      "2026-08-29"
    );
    expect(merged.upcoming).toHaveLength(1);
    expect(merged.upcoming[0].trip?.id).toBe("t-1");
    expect(merged.upcoming[0].diary?.day).toBe("2026-09-03");
  });

  it("diary days with no trip still read as visits; past sorts newest first", () => {
    const merged = mergeProjectDiary(
      [],
      [diaryDay("2026-03-04"), diaryDay("2026-03-05"), diaryDay("2026-09-03")],
      "2026-08-29"
    );
    expect(merged.upcoming.map((r) => r.day)).toEqual(["2026-09-03"]);
    expect(merged.past.map((r) => r.day)).toEqual(["2026-03-05", "2026-03-04"]);
  });

  it("an open trip with no day is the unplaced plan, ordered by due date", () => {
    const merged = mergeProjectDiary(
      [
        trip({ id: "t-2", dueDate: "2026-10-01" }),
        trip({ id: "t-1", dueDate: "2026-09-10" }),
      ],
      [],
      "2026-08-29"
    );
    expect(merged.unplaced.map((r) => r.trip?.id)).toEqual(["t-1", "t-2"]);
  });

  it("a closed trip lives on the day it RAN, not the day it was due", () => {
    expect(
      tripDay(trip({ id: "t-1", status: "done", completedAt: "2026-07-24", bookedDate: "2026-07-23" }))
    ).toBe("2026-07-24");
    expect(tripDay(trip({ id: "t-2", status: "done" }))).toBe("2026-09-01");
  });

  it("two trips on one day: the first takes the diary, the second stands alone", () => {
    const merged = mergeProjectDiary(
      [
        trip({ id: "t-1", bookedDate: "2026-09-03", status: "booked" }),
        trip({ id: "t-2", bookedDate: "2026-09-03", status: "booked" }),
      ],
      [diaryDay("2026-09-03")],
      "2026-08-29"
    );
    expect(merged.upcoming).toHaveLength(2);
    expect(merged.upcoming[0].diary).not.toBeNull();
    expect(merged.upcoming[1].diary).toBeNull();
  });
});
