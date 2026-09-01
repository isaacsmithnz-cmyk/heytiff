import {
  RAIL_PX_PER_HOUR,
  RAIL_ROW_PX,
  placeRail,
  railBounds,
  railSaysEmpty,
  railSpanLabel,
  railHourLabel,
  railHours,
  railItems,
  railTasksOf,
  railTop,
  zonedParts,
  type RailItem,
} from "../day-rail";
import type { ScheduleBlock } from "@/lib/workboard/schedule";

/* The rail's geometry is the half of it that can be WRONG: two bookings at
   once must not hide each other, a fifteen-minute call must still be
   readable, and a day that starts before seven must not draw above its own
   rail. */

const block = (over: Partial<ScheduleBlock> = {}): ScheduleBlock => ({
  key: "a1",
  remoteId: "j1",
  jobNumber: "3201",
  clientName: "O’Brien residence",
  suburb: "Maroochydore",
  status: "Work Order",
  categoryName: "Install",
  categoryColour: "#2e68ff",
  tracked: null,
  onSite: false,
  closure: "open",
  startMin: 8 * 60,
  endMin: 10 * 60,
  start: "2026-09-01 08:00:00",
  end: "2026-09-01 10:00:00",
  ...over,
});

const job = (over: Partial<ScheduleBlock> = {}): RailItem => {
  const b = block(over);
  return { kind: "job", key: `job:${b.key}`, startMin: b.startMin, endMin: b.endMin, job: b };
};

describe("railBounds", () => {
  it("draws a trade day even when nothing is on", () => {
    /* An empty rail still has to look like a day. Seven to five. */
    expect(railBounds([])).toEqual({ startMin: 7 * 60, endMin: 17 * 60 });
  });

  it("widens to whole hours for work outside the default, and never narrows", () => {
    const early = job({ key: "e", startMin: 6 * 60 + 20, endMin: 7 * 60 });
    const late = job({ key: "l", startMin: 17 * 60, endMin: 18 * 60 + 40 });
    expect(railBounds([early, late])).toEqual({ startMin: 6 * 60, endMin: 19 * 60 });
  });

  it("keeps the default ends when the day sits inside them", () => {
    expect(railBounds([job({ startMin: 9 * 60, endMin: 10 * 60 })])).toEqual({
      startMin: 7 * 60,
      endMin: 17 * 60,
    });
  });

  /* FOUND BY WALKING PROD at 6:07pm on an account with nothing booked: the
     bounds widened for items only, so the rail was always 7-to-5, the marker
     fell outside it, and the column drew five hundred blank pixels with no
     sign of where the present was. */
  it("makes room for now, so the marker can never fall off the rail", () => {
    expect(railBounds([], 18 * 60 + 7)).toEqual({ startMin: 7 * 60, endMin: 19 * 60 });
    expect(railBounds([], 5 * 60 + 40)).toEqual({ startMin: 5 * 60, endMin: 17 * 60 });
  });

  it("leaves the day alone when now is already inside it", () => {
    expect(railBounds([], 11 * 60 + 30)).toEqual({ startMin: 7 * 60, endMin: 17 * 60 });
    // exactly on the closing hour is inside, not past it
    expect(railBounds([], 17 * 60)).toEqual({ startMin: 7 * 60, endMin: 17 * 60 });
  });

  it("takes the wider of the work and the hour, never one instead of the other", () => {
    // work runs past now
    const late = job({ key: "l", startMin: 19 * 60, endMin: 20 * 60 });
    expect(railBounds([late], 8 * 60)).toEqual({ startMin: 7 * 60, endMin: 20 * 60 });
    // now runs past the work
    const early = job({ key: "e", startMin: 6 * 60, endMin: 7 * 60 });
    expect(railBounds([early], 18 * 60 + 30)).toEqual({ startMin: 6 * 60, endMin: 19 * 60 });
  });

  it("keeps the item-only bounds for a day that is not today", () => {
    /* `null` is how a caller says "there is no now on this rail". */
    expect(railBounds([], null)).toEqual({ startMin: 7 * 60, endMin: 17 * 60 });
  });
});

describe("railSaysEmpty", () => {
  /* THE LINE AND THE SCROLL GUARD MUST AGREE, which is why this is a function
     at all — they were written out separately and went out of step. */
  it("says the day is clear only when nothing is missing from it", () => {
    expect(railSaysEmpty(0, null)).toBe(true);
    expect(railSaysEmpty(0, "link")).toBe(false);
    expect(railSaysEmpty(0, "workboard")).toBe(false);
  });

  it("never says it about a day with something on it", () => {
    expect(railSaysEmpty(1, null)).toBe(false);
    expect(railSaysEmpty(3, "link")).toBe(false);
  });
});

describe("railSpanLabel", () => {
  /* EVERY ROW IS ONE HEIGHT, so the length has to be words. Isaac,
     2026-09-01: "just have the card at seven AM and just write down seven to
     three PM on the card". */
  it("speaks the meridiem once, at the end — his own example", () => {
    expect(railSpanLabel(7 * 60, 15 * 60)).toBe("7–3pm");
    expect(railSpanLabel(8 * 60, 10 * 60)).toBe("8–10am");
    expect(railSpanLabel(7 * 60 + 30, 9 * 60)).toBe("7:30–9am");
    expect(railSpanLabel(12 * 60, 13 * 60)).toBe("12–1pm");
    expect(railSpanLabel(9 * 60 + 15, 14 * 60 + 45)).toBe("9:15–2:45pm");
  });

  it("keeps both halves once the span is long enough to be ambiguous", () => {
    /* Under twelve hours, "7–3pm" cannot mean seven in the evening without
       running backwards. At twelve or more it can, so it says so. */
    expect(railSpanLabel(7 * 60, 19 * 60)).toBe("7am–7pm");
    expect(railSpanLabel(6 * 60, 20 * 60)).toBe("6am–8pm");
  });

  it("says one time when there is no span to speak of", () => {
    expect(railSpanLabel(9 * 60, 9 * 60)).toBe("9am");
    expect(railSpanLabel(9 * 60, 8 * 60)).toBe("9am");
  });

  /* THE END THAT IS EARLIER THAN EVERY START THAT REACHES IT. The board
     clamps a booking finishing on a later day to midnight, so an afternoon
     callout that runs over arrives as 1pm→24:00 — and the trailing "am"
     carried back over a bare "1" said one in the MORNING. Twelve hours out,
     on the row telling somebody when they are working tonight. */
  it("keeps both halves when the booking runs to midnight", () => {
    expect(railSpanLabel(13 * 60, 24 * 60)).toBe("1pm–12am");
    expect(railSpanLabel(17 * 60, 24 * 60)).toBe("5pm–12am");
    /* A morning start was already safe on span alone; it must stay put. */
    expect(railSpanLabel(8 * 60, 24 * 60)).toBe("8am–12am");
  });
});

describe("the hour scale", () => {
  it("puts the first hour at the top and an hour below it one hour of pixels down", () => {
    const b = railBounds([]);
    expect(railTop(7 * 60, b)).toBe(0);
    expect(railTop(8 * 60, b)).toBe(RAIL_PX_PER_HOUR);
    expect(railTop(8 * 60 + 30, b)).toBe(RAIL_PX_PER_HOUR * 1.5);
  });

  it("labels the ends with their half of the day and the middle without", () => {
    const b = railBounds([]);
    expect(railHours(b)).toHaveLength(11);
    expect(railHourLabel(7, b)).toBe("7 am");
    expect(railHourLabel(17, b)).toBe("5 pm");
    expect(railHourLabel(12, b)).toBe("12");
    expect(railHourLabel(15, b)).toBe("3");
  });

  /* A rail that reaches the end of the day closes on hour 24, and 24 is not
     less than 12 — so the last line of a rail running into the night named
     noon, the one hour furthest from where it was drawn. */
  it("closes a night rail on midnight, not noon", () => {
    const b = railBounds([job({ startMin: 13 * 60, endMin: 24 * 60 })]);
    expect(b.endMin).toBe(24 * 60);
    expect(railHours(b).at(-1)).toBe(24);
    expect(railHourLabel(24, b)).toBe("12 am");
    /* Midnight at the OTHER end still reads the same way. */
    const overnight = railBounds([job({ startMin: 0, endMin: 6 * 60 })]);
    expect(railHourLabel(0, overnight)).toBe("12 am");
  });
});

describe("placeRail", () => {
  const bounds = railBounds([]);

  it("puts a booking at its start time, one row high", () => {
    /* THE HEIGHT IS NOT THE DURATION, and that is the agreed design. Drawing
       each job at the height of its own hours produced a column of big empty
       boxes — a 2½-hour install is 160px of mostly nothing with its name in
       the corner — and the day stopped reading as a sequence you can scan.
       The start time is the fact the rail is for. */
    const [p] = placeRail([job({ startMin: 8 * 60, endMin: 10 * 60 })], bounds);
    expect(p.top).toBe(RAIL_PX_PER_HOUR);
    expect(p.height).toBe(RAIL_ROW_PX);
  });

  it("gives a fifteen-minute call the same row as a full day's install", () => {
    const short = placeRail([job({ startMin: 9 * 60, endMin: 9 * 60 + 15 })], bounds);
    const long = placeRail([job({ startMin: 9 * 60, endMin: 17 * 60 })], bounds);
    expect(short[0].height).toBe(RAIL_ROW_PX);
    expect(long[0].height).toBe(RAIL_ROW_PX);
  });

  it("leaves things that merely follow each other at full width", () => {
    /* THE TUNING THIS PINS. A 7:30 task and an 8:00 booking do not overlap in
       time, and must not be halved — the first version clustered on minutes
       plus a margin and split every pair inside an hour of each other, which
       halved and clipped every label on the rail. */
    const items = [
      job({ key: "a", startMin: 8 * 60, endMin: 9 * 60 }),
      job({ key: "b", startMin: 9 * 60, endMin: 10 * 60 }),
    ];
    expect(placeRail(items, bounds).every((p) => p.cols === 1)).toBe(true);
  });

  it("splits the lane when two rows would be drawn on top of each other", () => {
    /* Overlap is a question about the DRAWING now, not the hours: two jobs
       starting within half a row of each other collide on screen however long
       they run. Same times, same start — the second must not hide the first. */
    const items = [
      job({ key: "a", startMin: 8 * 60, endMin: 10 * 60 }),
      job({ key: "b", startMin: 8 * 60, endMin: 11 * 60 }),
    ];
    const placed = placeRail(items, bounds);
    expect(placed.map((p) => p.cols)).toEqual([2, 2]);
    expect(placed.map((p) => p.col)).toEqual([0, 1]);
  });

  it("splits three ways when three land on the same slot", () => {
    const items = [
      job({ key: "a", startMin: 9 * 60, endMin: 11 * 60 }),
      job({ key: "b", startMin: 9 * 60 + 5, endMin: 10 * 60 }),
      job({ key: "c", startMin: 9 * 60 + 10, endMin: 10 * 60 + 30 }),
    ];
    expect(placeRail(items, bounds).map((p) => p.cols)).toEqual([3, 3, 3]);
  });

  it("clusters transitively, and re-uses a column the moment it is free", () => {
    /* Rows that run into each other are laid out together, and a row that
       starts after an earlier one has finished DRAWING takes its column back
       rather than opening another and narrowing the whole run. What must hold
       is not a column count: it is that nothing shares a column with anything
       it overlaps. */
    const items = [
      job({ key: "a", startMin: 8 * 60, endMin: 9 * 60 }),
      job({ key: "b", startMin: 8 * 60 + 10, endMin: 9 * 60 + 30 }),
      job({ key: "c", startMin: 8 * 60 + 20, endMin: 10 * 60 }),
    ];
    const placed = placeRail(items, bounds);

    // one cluster: they all agree on how many columns the run is wide
    expect(new Set(placed.map((p) => p.cols)).size).toBe(1);

    for (const p of placed) {
      for (const q of placed) {
        if (p === q || p.col !== q.col) continue;
        const apart = p.top + p.height <= q.top || q.top + q.height <= p.top;
        expect(apart).toBe(true);
      }
    }
  });

  it("puts a cluster's columns in clock order, left to right", () => {
    const items = [
      job({ key: "late", startMin: 9 * 60, endMin: 11 * 60 }),
      job({ key: "early", startMin: 8 * 60, endMin: 10 * 60 }),
    ];
    const placed = placeRail(items, bounds);
    expect(placed[0].item.key).toBe("job:early");
    expect(placed[0].col).toBe(0);
  });
});

describe("what earns a place on the day", () => {
  const TZ = "Australia/Brisbane";

  it("takes a task that named an hour today", () => {
    const tasks = railTasksOf(
      [
        {
          id: "t1",
          title: "Hilux 60,000 km service",
          remindAt: "2026-08-31T21:30:00Z", // 7:30 the next morning in Brisbane
          dueDate: "2026-09-01",
          status: "open",
        },
      ],
      "2026-09-01",
      TZ,
      null,
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0].atMin).toBe(7 * 60 + 30);
  });

  it("leaves a task that is merely due today off the rail", () => {
    /* A due date is a day, not an hour. Dropping every loose to-do onto 5pm
       would say something the data never said. */
    const tasks = railTasksOf(
      [{ id: "t2", title: "Book the tip run", remindAt: null, dueDate: "2026-09-01", status: "open" }],
      "2026-09-01",
      TZ,
      null,
    );
    expect(tasks).toEqual([]);
  });

  it("leaves another day's reminder alone, and finished work with it", () => {
    const rows = [
      { id: "t3", title: "Tomorrow", remindAt: "2026-09-01T22:00:00Z", dueDate: "2026-09-02", status: "open" },
      { id: "t4", title: "Done", remindAt: "2026-08-31T23:00:00Z", dueDate: "2026-09-01", status: "done" },
    ];
    expect(railTasksOf(rows, "2026-09-01", TZ, null)).toEqual([]);
  });

  it("marks a reminder the clock has passed", () => {
    const [t] = railTasksOf(
      [{ id: "t5", title: "Chase Daikin", remindAt: "2026-08-31T23:00:00Z", dueDate: "2026-09-01", status: "open" }],
      "2026-09-01",
      TZ,
      12 * 60,
    );
    expect(t.atMin).toBe(9 * 60);
    expect(t.overdue).toBe(true);
  });

  it("draws a task as a moment, so it never pushes a booking sideways for time nobody claimed", () => {
    const items = railItems(
      [block({ startMin: 9 * 60, endMin: 11 * 60 })],
      [{ id: "t", title: "Service", atMin: 12 * 60, kind: "at", overdue: false }],
    );
    const task = items.find((i) => i.kind === "task")!;
    expect(task.startMin).toBe(task.endMin);
    expect(placeRail(items, railBounds(items)).every((p) => p.cols === 1)).toBe(true);
  });
});

describe("at, or by", () => {
  const TZ = "Australia/Brisbane";
  const row = (over: Record<string, unknown> = {}) => ({
    id: "t1",
    title: "Crane truck back in the yard",
    remindAt: "2026-09-01T06:00:00Z", // 4pm Brisbane
    dueDate: "2026-09-01",
    status: "open",
    ...over,
  });

  it("carries a deadline through as a deadline", () => {
    /* The whole reason the column exists: 4pm on a `by` row is the moment the
       time is UP, and drawing it as a start time tells you to begin when you
       should already have finished. */
    const [t] = railTasksOf([row({ remindKind: "by" as const })], "2026-09-01", TZ, null);
    expect(t.kind).toBe("by");
    expect(t.atMin).toBe(16 * 60);
  });

  it("reads a task with no word on it as an appointment", () => {
    /* Every reminder written before the column existed came from "remind me
       Monday morning", which is an `at`. The absence already means the right
       thing, so nothing was backfilled — see docs/migrations/task_remind_kind.sql. */
    const [t] = railTasksOf([row()], "2026-09-01", TZ, null);
    expect(t.kind).toBe("at");
  });

  it("still marks a passed deadline overdue, on the same arithmetic", () => {
    /* A missed deadline and a late nudge are the same fact — past its time.
       `kind` says which it was; it does not get its own lateness rule. */
    const [t] = railTasksOf([row({ remindKind: "by" as const })], "2026-09-01", TZ, 17 * 60);
    expect(t.kind).toBe("by");
    expect(t.overdue).toBe(true);
  });

  it("keeps a deadline off the rail when it named no hour", () => {
    /* `by` alone is not a moment. The database refuses the pair outright, and
       the rail would have nowhere to draw it even if it did not. */
    expect(
      railTasksOf([row({ remindAt: null, remindKind: "by" as const })], "2026-09-01", TZ, null),
    ).toEqual([]);
  });
});

describe("zonedParts", () => {
  it("reads the day and the time in the workspace's zone, not the server's", () => {
    /* 2026-09-01T14:30:00Z is the first of September in Brisbane (00:30 on the
       2nd) — the day and the clock have to come from one answer or they can
       disagree across a boundary. */
    expect(zonedParts("2026-09-01T14:30:00Z", "Australia/Brisbane")).toEqual({
      day: "2026-09-02",
      min: 30,
    });
  });

  it("survives an unreadable stamp or zone rather than throwing", () => {
    expect(zonedParts("not a date", "Australia/Brisbane")).toBeNull();
    expect(zonedParts(null, "Australia/Brisbane")).toBeNull();
    expect(zonedParts("2026-09-01T00:00:00Z", "Mars/Olympus")).toBeNull();
  });

  it("reads midnight as zero, whichever way ICU renders the hour", () => {
    const at = zonedParts("2026-09-01T14:00:00Z", "Australia/Brisbane");
    expect(at).toEqual({ day: "2026-09-02", min: 0 });
  });
});
