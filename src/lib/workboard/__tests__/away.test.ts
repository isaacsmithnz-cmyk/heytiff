/* Time off on the day (leave to ServiceM8, part two), held still. The rows
   are the live account's shapes, read 2026-09-28: a whole day is 00:00:00
   to 23:59:59, a part day carries real times, the three types, and names
   typed by hand ("SICK", "TAFE", "MICK GOLF"). */

import {
  availabilityOnDay,
  awayInSlot,
  awaySpanOnDay,
  awayWord,
  closedInSlot,
  closedLabel,
  overlaps,
  type AvailabilityRow,
} from "../away";

const DAY = "2026-09-29";

const row = (over: Partial<AvailabilityRow> & { uuid: string }): AvailabilityRow => ({
  regardingObject: "staff",
  regardingUuid: "s-1",
  name: "SICK",
  type: "staff-annual-leave",
  start: `${DAY} 00:00:00`,
  end: `${DAY} 23:59:59`,
  ...over,
});

describe("availabilityOnDay", () => {
  it("keeps the rows that touch the day, a person's apart from the business's", () => {
    const out = availabilityOnDay(
      [
        row({ uuid: "sick" }),
        row({ uuid: "tafe", regardingUuid: "s-2", name: "TAFE", start: `${DAY} 07:00:00`, end: `${DAY} 10:30:00` }),
        row({ uuid: "labour", regardingObject: "vendor", regardingUuid: "v-1", name: "Labour Day", type: "public-holiday" }),
        row({ uuid: "shut", regardingObject: "vendor", regardingUuid: "v-1", name: " ", type: "business-closed" }),
      ],
      DAY
    );
    expect(out.away.map((a) => [a.uuid, a.staffUuid, a.name])).toEqual([
      ["sick", "s-1", "SICK"],
      ["tafe", "s-2", "TAFE"],
    ]);
    expect(out.closed.map((c) => [c.uuid, c.kind, c.name])).toEqual([
      ["labour", "holiday", "Labour Day"],
      // a name of nothing but space is no name
      ["shut", "closed", null],
    ]);
  });

  it("(F) holds a fortnight's leave that began last week, and not leave that ended at midnight", () => {
    const out = availabilityOnDay(
      [
        row({ uuid: "holidays", name: "Holidays", start: "2026-09-21 00:00:00", end: "2026-10-03 23:59:59" }),
        row({ uuid: "yesterday", start: "2026-09-28 00:00:00", end: `${DAY} 00:00:00` }),
        row({ uuid: "tomorrow", start: "2026-09-30 00:00:00", end: "2026-09-30 23:59:59" }),
      ],
      DAY
    );
    expect(out.away.map((a) => a.uuid)).toEqual(["holidays"]);
  });

  it("leaves out what can't be placed: no span, a span backwards, nobody named, an object it doesn't know", () => {
    const out = availabilityOnDay(
      [
        row({ uuid: "no-start", start: null }),
        row({ uuid: "garbled", end: "tomorrow" }),
        row({ uuid: "backwards", start: `${DAY} 10:00:00`, end: `${DAY} 09:00:00` }),
        row({ uuid: "nobody", regardingUuid: null }),
        row({ uuid: "job", regardingObject: "job" }),
      ],
      DAY
    );
    expect(out).toEqual({ away: [], closed: [] });
  });

  it("never reads a sick day as a kind of leave: every staff row is time off, whatever it's called", () => {
    const out = availabilityOnDay(
      [row({ uuid: "a", name: "SICK" }), row({ uuid: "b", name: "MICK GOLF" }), row({ uuid: "c", type: "something-new" })],
      DAY
    );
    expect(out.away.map((a) => a.name)).toEqual(["SICK", "MICK GOLF", "SICK"]);
    expect(Object.keys(out.away[0]).sort()).toEqual(["end", "name", "staffUuid", "start", "uuid"]);
  });
});

describe("awaySpanOnDay", () => {
  it("(F) reads ServiceM8's whole day as the whole day", () => {
    expect(awaySpanOnDay({ start: `${DAY} 00:00:00`, end: `${DAY} 23:59:59` }, DAY)).toEqual({ startMin: 0, endMin: 1440, whole: true });
  });

  it("places a part day by its wall-clock times, never a Date", () => {
    expect(awaySpanOnDay({ start: `${DAY} 07:00:00`, end: `${DAY} 10:30:00` }, DAY)).toEqual({ startMin: 420, endMin: 630, whole: false });
  });

  it("clips time off from other days to this one", () => {
    expect(awaySpanOnDay({ start: "2026-09-21 13:00:00", end: "2026-10-03 23:59:59" }, DAY)).toEqual({ startMin: 0, endMin: 1440, whole: true });
    expect(awaySpanOnDay({ start: `${DAY} 13:00:00`, end: "2026-09-30 09:00:00" }, DAY)).toEqual({ startMin: 780, endMin: 1440, whole: false });
    expect(awaySpanOnDay({ start: "2026-09-28 13:00:00", end: `${DAY} 09:00:00` }, DAY)).toEqual({ startMin: 0, endMin: 540, whole: false });
  });
});

describe("the words", () => {
  it("say the business's own word, as typed, and 'Time off' where it typed none", () => {
    expect(awayWord({ name: "MICK GOLF" })).toBe("MICK GOLF");
    expect(awayWord({ name: null })).toBe("Time off");
    expect(closedLabel({ kind: "holiday" })).toBe("Public holiday");
    expect(closedLabel({ kind: "closed" })).toBe("Closed");
  });
});

describe("in a slot — Book in's warning", () => {
  const away = [
    { uuid: "tafe", staffUuid: "5A0E-S1", name: "TAFE", start: `${DAY} 07:00:00`, end: `${DAY} 10:30:00` },
    { uuid: "other", staffUuid: "s-2", name: "SICK", start: `${DAY} 00:00:00`, end: `${DAY} 23:59:59` },
  ];

  it("(F) finds the person's time off under the slot, by their uuid in any case", () => {
    expect(awayInSlot(away, "5a0e-s1", { start: `${DAY} 10:00:00`, end: `${DAY} 12:00:00` }).map((a) => a.uuid)).toEqual(["tafe"]);
  });

  it("(F) a slot that starts as the time off ends, or ends as it starts, doesn't overlap it", () => {
    expect(awayInSlot(away, "5a0e-s1", { start: `${DAY} 10:30:00`, end: `${DAY} 12:30:00` })).toEqual([]);
    expect(awayInSlot(away, "5a0e-s1", { start: `${DAY} 05:00:00`, end: `${DAY} 07:00:00` })).toEqual([]);
    expect(overlaps({ start: "b", end: "c" }, "a", "b")).toBe(false);
  });

  it("finds a closure under any slot of its span", () => {
    const closed = [{ uuid: "x", kind: "holiday" as const, name: "Labour Day", start: `${DAY} 00:00:00`, end: `${DAY} 23:59:59` }];
    expect(closedInSlot(closed, { start: `${DAY} 07:00:00`, end: `${DAY} 09:00:00` })).toHaveLength(1);
    expect(closedInSlot(closed, { start: "2026-09-30 07:00:00", end: "2026-09-30 09:00:00" })).toHaveLength(0);
  });
});
