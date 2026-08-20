/* The day board's law, held still. The fixtures that matter are lifted from
   the LIVE mirror (2026-08-10/11/14), because the two bugs this module exists
   to prevent were both found in real rows:

   - a person's BOOKED hour and their RECORDED time overlap on the same job
     (Alex Lorenz, job 3163: booked 08:00–09:00, recorded 08:09–09:25) — so
     drawing anything but `activity_was_scheduled = 1` shows one person in
     two places;
   - a crew job is one row PER PERSON (job 2694: four techs, 07:00–15:00
     each) — so four blocks across four lanes is correct, not a duplicate. */

import {
  clockLabel,
  fmtHoursShort,
  layoutScheduleDay,
  closureOf,
  minutesOfNaive,
  onSiteKey,
  railBoundsOf,
  stackLane,
  type ScheduleActivity,
  type ScheduleBlock,
} from "../schedule";
import type { AllJobsMirrorJob } from "../all-jobs";

const job = (over: Partial<AllJobsMirrorJob> & { remoteId: string }): AllJobsMirrorJob => ({
  jobNumber: "3163",
  status: "Work Order",
  clientName: "SQM Real Estate",
  description: null,
  suburb: "Alexandria",
  categoryName: "Service Call",
  categoryColour: "#ffb5b5",
  date: null,
  quoteDate: null,
  completionDate: null,
  nextBooking: null,
  money: null,
  paidCents: 0,
  ...over,
});

const act = (over: Partial<ScheduleActivity> & { uuid: string }): ScheduleActivity => ({
  jobUuid: "j-1",
  staffUuid: "s-1",
  start: "2026-08-10 08:00:00",
  end: "2026-08-10 09:00:00",
  wasScheduled: 1,
  ...over,
});

const STAFF = [
  { uuid: "s-1", name: "Alex Lorenz" },
  { uuid: "s-2", name: "Luke Ingold" },
  { uuid: "s-3", name: "Callum Vrieze" },
  { uuid: "s-4", name: "Oleksii Khalameida" },
];

describe("minutesOfNaive", () => {
  it("slices a naive stamp into minutes past midnight", () => {
    expect(minutesOfNaive("2026-08-11 07:30:00")).toBe(450);
    expect(minutesOfNaive("2026-08-11 00:00:00")).toBe(0);
    expect(minutesOfNaive("2026-08-11 23:59:59")).toBe(1439);
  });

  it("refuses anything that isn't the mirror's shape", () => {
    expect(minutesOfNaive(null)).toBeNull();
    expect(minutesOfNaive("")).toBeNull();
    expect(minutesOfNaive("2026-08-11T07:30:00")).toBeNull(); // ISO T, not the mirror's space
    expect(minutesOfNaive("2026-08-11 25:00:00")).toBeNull();
    expect(minutesOfNaive("not a date")).toBeNull();
  });
});

describe("labels", () => {
  it("speaks the rail's clock", () => {
    expect(clockLabel(360)).toBe("6am");
    expect(clockLabel(450)).toBe("7:30am");
    expect(clockLabel(720)).toBe("12pm");
    expect(clockLabel(0)).toBe("12am");
    expect(clockLabel(810)).toBe("1:30pm");
  });

  it("speaks the lane's load", () => {
    expect(fmtHoursShort(480)).toBe("8h");
    expect(fmtHoursShort(450)).toBe("7h30");
    expect(fmtHoursShort(45)).toBe("0h45");
  });
});

describe("the scheduled-only filter — the most important line in the feature", () => {
  it("draws the booked hour and NOT the recorded time on the same job", () => {
    // Alex Lorenz on 2026-08-10, job 3163, verbatim from the live mirror.
    const day = layoutScheduleDay({
      activities: [
        act({ uuid: "booked", start: "2026-08-10 08:00:00", end: "2026-08-10 09:00:00" }),
        act({
          uuid: "recorded",
          start: "2026-08-10 08:09:19",
          end: "2026-08-10 09:25:40",
          wasScheduled: 0,
        }),
      ],
      staff: STAFF,
      jobs: [job({ remoteId: "j-1" })],
    });
    expect(day.totalBookings).toBe(1);
    expect(day.lanes).toHaveLength(1);
    expect(day.lanes[0].blocks[0].key).toBe("booked");
  });

  it("treats a null flag as unscheduled, never as booked", () => {
    const day = layoutScheduleDay({
      activities: [act({ uuid: "a", wasScheduled: null })],
      staff: STAFF,
      jobs: [job({ remoteId: "j-1" })],
    });
    expect(day.totalBookings).toBe(0);
  });
});

describe("lanes", () => {
  it("draws a crew job once per person — job 2694's shape", () => {
    const four = ["s-1", "s-2", "s-3", "s-4"].map((s, i) =>
      act({
        uuid: `a-${i}`,
        staffUuid: s,
        jobUuid: "j-2694",
        start: "2026-08-11 07:00:00",
        end: "2026-08-11 15:00:00",
      })
    );
    const day = layoutScheduleDay({
      activities: four,
      staff: STAFF,
      jobs: [job({ remoteId: "j-2694", jobNumber: "2694" })],
    });
    expect(day.lanes).toHaveLength(4);
    expect(day.totalBookings).toBe(4);
    expect(day.jobCount).toBe(1);
    for (const lane of day.lanes) expect(lane.blocks[0].jobNumber).toBe("2694");
  });

  it("stacks a genuine double-book down, never on top — Lorenz's 07:30/08:00", () => {
    const day = layoutScheduleDay({
      activities: [
        act({ uuid: "a1", jobUuid: "j-1713", start: "2026-08-10 07:30:00", end: "2026-08-10 08:30:00" }),
        act({ uuid: "a2", jobUuid: "j-3163", start: "2026-08-10 08:00:00", end: "2026-08-10 09:00:00" }),
      ],
      staff: STAFF,
      jobs: [job({ remoteId: "j-1713", jobNumber: "1713" }), job({ remoteId: "j-3163" })],
    });
    expect(day.lanes).toHaveLength(1);
    expect(day.lanes[0].rows).toHaveLength(2);
  });

  it("reuses a sub-row once its last block has ended", () => {
    const rows = stackLane([
      { startMin: 420, endMin: 480 },
      { startMin: 480, endMin: 540 },
      { startMin: 450, endMin: 510 },
    ] as ScheduleBlock[]);
    // sorted input is the caller's contract — hand it sorted
    const sorted = stackLane(
      ([
        { startMin: 420, endMin: 480 },
        { startMin: 450, endMin: 510 },
        { startMin: 480, endMin: 540 },
      ] as ScheduleBlock[])
    );
    expect(sorted).toHaveLength(2);
    expect(sorted[0].map((b) => b.startMin)).toEqual([420, 480]);
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("puts the earliest starter on top, ties broken by name", () => {
    const day = layoutScheduleDay({
      activities: [
        act({ uuid: "late", staffUuid: "s-2", start: "2026-08-10 09:00:00", end: "2026-08-10 10:00:00" }),
        act({ uuid: "early", staffUuid: "s-1", start: "2026-08-10 07:00:00", end: "2026-08-10 08:00:00" }),
      ],
      staff: STAFF,
      jobs: [job({ remoteId: "j-1" })],
    });
    expect(day.lanes.map((l) => l.name)).toEqual(["Alex Lorenz", "Luke Ingold"]);
  });

  it("lands a booking nobody owns in a named last lane — said, not dropped", () => {
    const day = layoutScheduleDay({
      activities: [
        act({ uuid: "mine", staffUuid: "s-1" }),
        act({ uuid: "nobody", staffUuid: null }),
        act({ uuid: "ghost", staffUuid: "s-unknown" }),
      ],
      staff: STAFF,
      jobs: [job({ remoteId: "j-1" })],
    });
    expect(day.lanes).toHaveLength(2);
    const last = day.lanes[day.lanes.length - 1];
    expect(last.name).toBe("Nobody named");
    expect(last.blocks.map((b) => b.key).sort()).toEqual(["ghost", "nobody"]);
  });

  it("sums a lane's minutes — the load the admin balances with", () => {
    const day = layoutScheduleDay({
      activities: [
        act({ uuid: "a", start: "2026-08-10 07:00:00", end: "2026-08-10 11:00:00" }),
        act({ uuid: "b", start: "2026-08-10 11:30:00", end: "2026-08-10 14:00:00" }),
      ],
      staff: STAFF,
      jobs: [job({ remoteId: "j-1" })],
    });
    expect(day.lanes[0].minutes).toBe(240 + 150);
    expect(day.totalMinutes).toBe(390);
  });
});

describe("spans", () => {
  it("gives a zero or reversed span 30 clickable minutes", () => {
    const day = layoutScheduleDay({
      activities: [
        act({ uuid: "zero", end: "2026-08-10 08:00:00" }),
        act({ uuid: "reversed", end: "2026-08-10 07:00:00" }),
        act({ uuid: "endless", end: null }),
      ],
      staff: STAFF,
      jobs: [job({ remoteId: "j-1" })],
    });
    for (const b of day.lanes[0].blocks) expect(b.endMin - b.startMin).toBe(30);
  });

  it("clamps a booking that crosses midnight to the day's edge", () => {
    const day = layoutScheduleDay({
      activities: [
        act({ uuid: "overnight", start: "2026-08-10 22:00:00", end: "2026-08-11 06:15:00" }),
      ],
      staff: STAFF,
      jobs: [job({ remoteId: "j-1" })],
    });
    expect(day.lanes[0].blocks[0].endMin).toBe(24 * 60);
    expect(day.railEnd).toBe(24 * 60);
  });
});

describe("the rail", () => {
  it("holds 6am–6pm for an ordinary day", () => {
    expect(railBoundsOf([{ startMin: 420, endMin: 900 }])).toEqual({ start: 360, end: 1080 });
  });

  it("widens to whole hours for real blocks, never narrows", () => {
    expect(railBoundsOf([{ startMin: 315, endMin: 1170 }])).toEqual({ start: 300, end: 1200 });
    expect(railBoundsOf([])).toEqual({ start: 360, end: 1080 });
  });
});

describe("ownership outranks category", () => {
  it("marks a tracked job's block and leaves the rest alone", () => {
    const tracked = new Map([["j-2694", { kind: "project" as const, label: "Enmore install" }]]);
    const day = layoutScheduleDay({
      activities: [
        act({ uuid: "a", jobUuid: "j-2694" }),
        act({ uuid: "b", staffUuid: "s-2", jobUuid: "j-1" }),
      ],
      staff: STAFF,
      jobs: [job({ remoteId: "j-2694" }), job({ remoteId: "j-1" })],
      tracked,
    });
    const blocks = day.lanes.flatMap((l) => l.blocks);
    expect(blocks.find((b) => b.remoteId === "j-2694")?.tracked?.label).toBe("Enmore install");
    expect(blocks.find((b) => b.remoteId === "j-1")?.tracked).toBeNull();
  });
});

/* ── has anyone started it? ──
   The rail's second reading, and the one thing ServiceM8's status cannot say:
   a job sits at `Work Order` whether the tech is on site or still in bed. */
describe("onSite", () => {
  const day = (onSite?: Set<string>) =>
    layoutScheduleDay({
      activities: [
        act({ uuid: "a-1", jobUuid: "j-1", staffUuid: "s-1" }),
        act({ uuid: "a-2", jobUuid: "j-2", staffUuid: "s-2" }),
      ],
      staff: STAFF,
      jobs: [job({ remoteId: "j-1" }), job({ remoteId: "j-2" })],
      onSite,
    });

  const blockFor = (d: ReturnType<typeof day>, staffUuid: string) =>
    d.lanes.find((l) => l.staffUuid === staffUuid)!.blocks[0];

  it("marks only the booking whose own job AND person recorded time", () => {
    const d = day(new Set([onSiteKey("j-1", "s-1")]));
    expect(blockFor(d, "s-1").onSite).toBe(true);
    expect(blockFor(d, "s-2").onSite).toBe(false);
  });

  it("does not let one person's recorded time start another's booking", () => {
    // the same JOB, clocked by somebody else — says nothing about this booking
    const d = day(new Set([onSiteKey("j-1", "s-9")]));
    expect(blockFor(d, "s-1").onSite).toBe(false);
  });

  it("keys the unassigned lane on itself rather than on nothing", () => {
    const d = layoutScheduleDay({
      activities: [act({ uuid: "a-1", jobUuid: "j-1", staffUuid: null })],
      staff: STAFF,
      jobs: [job({ remoteId: "j-1" })],
      onSite: new Set([onSiteKey("j-1", null)]),
    });
    expect(d.lanes[0].blocks[0].onSite).toBe(true);
  });

  it("says a day tracks time only when a drawn booking carries some", () => {
    expect(day(new Set([onSiteKey("j-1", "s-1")])).tracksTime).toBe(true);
    // recorded time that belongs to no booking on this rail does not count:
    // an account that never clocks on must not have its whole day hollowed
    expect(day(new Set([onSiteKey("j-99", "s-99")])).tracksTime).toBe(false);
    expect(day(new Set()).tracksTime).toBe(false);
    expect(day(undefined).tracksTime).toBe(false);
  });

  it("treats a missing set as nothing recorded, never as everything", () => {
    const d = day(undefined);
    expect(d.lanes.every((l) => l.blocks.every((b) => !b.onSite))).toBe(true);
  });
});

describe("onSiteKey", () => {
  it("pairs a job with a person, and keeps the pairs apart", () => {
    expect(onSiteKey("j-1", "s-1")).toBe("j-1|s-1");
    expect(onSiteKey("j-1", null)).toBe("j-1|");
    expect(onSiteKey("j-1", "s-1")).not.toBe(onSiteKey("j-1", "s-2"));
    expect(onSiteKey("j-1", null)).not.toBe(onSiteKey("j-2", null));
  });
});

/* ── the ServiceM8 bug this rail refuses to repeat ──
   There is no per-BOOKING status, only per-job. Completing a job for the day
   marks its later bookings complete too, and the crew turn up to work the
   office thinks is finished. `completionDate` is what tells the two apart. */
describe("closureOf", () => {
  it("leaves an open job alone whatever its dates say", () => {
    expect(closureOf("Work Order", null, "2026-08-14 07:00:00")).toBe("open");
    expect(closureOf("Quote", "2026-08-10 16:00:00", "2026-08-14 07:00:00")).toBe("open");
    expect(closureOf(null, null, "2026-08-14 07:00:00")).toBe("open");
  });

  it("calls a booking done when it is on or before the day the job closed", () => {
    expect(closureOf("Completed", "2026-08-14 16:20:00", "2026-08-14 07:00:00")).toBe("done");
    expect(closureOf("Completed", "2026-08-14 16:20:00", "2026-08-11 07:00:00")).toBe("done");
  });

  it("calls a booking AFTER the completion stale, not done", () => {
    // the whole point: job closed on the 14th, still booked on the 18th
    expect(closureOf("Completed", "2026-08-14 16:20:00", "2026-08-18 07:00:00")).toBe("stale");
  });

  it("compares days, never times — a job closed at 9am covers a 3pm booking", () => {
    expect(closureOf("Completed", "2026-08-14 09:00:00", "2026-08-14 15:00:00")).toBe("done");
  });

  it("falls back to done when there is no completion date to compare against", () => {
    // calling live work stale is the more expensive mistake — it puts a
    // warning on a job somebody is about to drive to
    expect(closureOf("Completed", null, "2026-08-18 07:00:00")).toBe("done");
    expect(closureOf("Completed", "", "2026-08-18 07:00:00")).toBe("done");
    expect(closureOf("Completed", "nope", "2026-08-18 07:00:00")).toBe("done");
  });

  it("rides on the block, so one job's blocks can differ", () => {
    const d = layoutScheduleDay({
      activities: [
        act({ uuid: "a-1", jobUuid: "j-1", staffUuid: "s-1", start: "2026-08-10 08:00:00",
              end: "2026-08-10 09:00:00" }),
      ],
      staff: STAFF,
      jobs: [job({ remoteId: "j-1", status: "Completed", completionDate: "2026-08-08 15:00:00" })],
    });
    // this booking sits two days after the job was closed off
    expect(d.lanes[0].blocks[0].closure).toBe("stale");
  });
});
