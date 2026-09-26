import {
  jobsOnRail,
  railCrewOf,
  railMissing,
  railSaysEmpty,
  railWhereOf,
  railSpanLabel,
  railTasksOf,
  zonedParts,
} from "../day-rail";
import { layoutScheduleDay, type ScheduleBlock } from "@/lib/workboard/schedule";

/* The day's facts for "Your day": what earns a place on it, what it is
   short of, the span a card says, and whose jobs and streets ride to the
   browser with it. (The rail's and the old band's geometry went with the
   old Home.) */

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

describe("railMissing", () => {
  it("names the layer a ServiceM8 workspace is short of", () => {
    expect(railMissing({ connected: true, enabled: false, linked: false })).toBe("workboard");
    expect(railMissing({ connected: true, enabled: true, linked: false })).toBe("link");
    expect(railMissing({ connected: true, enabled: true, linked: true })).toBeNull();
  });

  it("gives a workspace without ServiceM8 no ServiceM8 sentence — its day is complete", () => {
    /* nobody can be linked to a ServiceM8 it does not have, and there are
       no bookings anywhere for the workboard gate to be hiding */
    expect(railMissing({ connected: false, enabled: true, linked: false })).toBeNull();
    expect(railMissing({ connected: false, enabled: false, linked: false })).toBeNull();
    expect(railSaysEmpty(0, railMissing({ connected: false, enabled: true, linked: false }))).toBe(true);
  });
});

describe("railCrewOf — who else is on your jobs today", () => {
  const DAY = "2026-09-24";
  const act = (uuid: string, job: string, staff: string | null, from: string, to: string) => ({
    uuid,
    jobUuid: job,
    staffUuid: staff,
    start: `${DAY} ${from}:00`,
    end: `${DAY} ${to}:00`,
    wasScheduled: 1,
  });
  const mirrorJob = (remoteId: string) => ({
    remoteId,
    jobNumber: remoteId,
    status: "Work Order",
    clientName: null,
    description: null,
    suburb: null,
    categoryName: null,
    categoryColour: null,
    date: null,
    quoteDate: null,
    completionDate: null,
    nextBooking: null,
    money: null,
    paidCents: 0,
  });
  const staff = [
    { uuid: "me", name: "Isaac Smith" },
    { uuid: "luke", name: "Luke Ingold" },
    { uuid: "cal", name: "Callum Reid" },
    { uuid: "cal2", name: "Callum Brown" },
    { uuid: "dan", name: "Dane Park" },
  ];
  const lay = (activities: ReturnType<typeof act>[]) => {
    const day = layoutScheduleDay({ activities, staff, jobs: ["3342", "3315", "1377"].map(mirrorJob) });
    const mine = day.lanes.filter((l) => l.staffUuid === "me").flatMap((l) => l.blocks);
    return { lanes: day.lanes, mine };
  };

  it("names everyone else booked on the same job that day, by first name, and never the viewer", () => {
    const { lanes, mine } = lay([
      act("a1", "3342", "me", "16:45", "17:45"),
      act("a2", "3342", "luke", "16:45", "17:45"),
      // a different hour on the same job still counts: the job is shared
      act("a3", "3342", "dan", "07:00", "08:00"),
      act("a4", "1377", "dan", "09:00", "10:00"),
    ]);
    expect(railCrewOf(lanes, mine, "me")).toEqual({ "3342": ["Dane", "Luke"] });
  });

  it("leaves out a job nobody else is on — With is dropped, not 'Solo'", () => {
    const { lanes, mine } = lay([act("a1", "3315", "me", "17:00", "18:00"), act("a2", "1377", "luke", "17:00", "18:00")]);
    expect(railCrewOf(lanes, mine, "me")).toEqual({});
  });

  it("names a person once however many times they are booked, and keeps two Callums apart", () => {
    const { lanes, mine } = lay([
      act("a1", "3342", "me", "09:00", "10:00"),
      act("a2", "3342", "cal", "09:00", "10:00"),
      act("a3", "3342", "cal", "13:00", "14:00"),
      act("a4", "3342", "cal2", "13:00", "14:00"),
    ]);
    expect(railCrewOf(lanes, mine, "me")).toEqual({ "3342": ["Callum Reid", "Callum Brown"] });
  });

  it("does not count a booking nobody owns as a person", () => {
    const { lanes, mine } = lay([act("a1", "3342", "me", "09:00", "10:00"), act("a2", "3342", null, "09:00", "10:00")]);
    expect(lanes.some((l) => l.staffUuid === "")).toBe(true);
    expect(railCrewOf(lanes, mine, "me")).toEqual({});
  });
});

describe("jobsOnRail — the rows behind the cards, and only those", () => {
  it("keeps the blocks' jobs in the blocks' order, once each, and nobody else's", () => {
    const jobs = [{ remoteId: "j2" }, { remoteId: "j1" }, { remoteId: "j3" }];
    const blocks = [
      block({ key: "a", remoteId: "j1" }),
      block({ key: "b", remoteId: "j2" }),
      block({ key: "c", remoteId: "j1" }),
    ];
    expect(jobsOnRail(blocks, jobs).map((j) => j.remoteId)).toEqual(["j1", "j2"]);
  });

  it("has nothing for a block whose job did not come", () => {
    expect(jobsOnRail([block({ remoteId: "gone" })], [{ remoteId: "j1" }])).toEqual([]);
  });
});

describe("railWhereOf — the jobs on your day only", () => {
  it("keeps the entries for this bar's jobs and drops everyone else's", () => {
    const addresses = { "3342": "Carrington St", "9999": "Somebody Else's Rd" };
    expect(railWhereOf([{ remoteId: "3342" }, { remoteId: "3315" }], addresses)).toEqual({ "3342": "Carrington St" });
  });

  it("reads only the record's own keys", () => {
    expect(railWhereOf([{ remoteId: "constructor" }], {} as Record<string, string>)).toEqual({});
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
