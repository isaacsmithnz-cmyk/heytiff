/* ONE JOB, READ OFF A DAY — the judgement two surfaces share. The rail draws
   it as treatment and the capacity window's day card writes it as a word, so
   what is pinned here is that there is only ONE answer: the gates that let a
   block go hollow, the narrower late case on top, and the marks a job's own
   paint is decoded into. */

import { blockLabel, blockPaint, blockState, dayStateOfMarks, focusJobOf } from "../focus";
import { layoutScheduleDay, type ScheduleActivity } from "../schedule";
import { scheduleBlockPaint, TRACKED_PAINT } from "../schedule-colour";
import type { AllJobsMirrorJob } from "../all-jobs";

const DAY = "2026-08-14";

const job = (over: Partial<AllJobsMirrorJob> & { remoteId: string }): AllJobsMirrorJob => ({
  jobNumber: "3145",
  status: "Work Order",
  paidCents: 0,
  clientName: "Rifkin, Julian",
  description: null,
  suburb: "Enmore",
  categoryName: "Install",
  categoryColour: "#e7b5ff",
  date: null,
  quoteDate: null,
  completionDate: null,
  nextBooking: null,
  money: null,
  ...over,
});

const act = (over: Partial<ScheduleActivity> & { uuid: string }): ScheduleActivity => ({
  jobUuid: "j-1",
  staffUuid: "s-alex",
  start: `${DAY} 07:00:00`,
  end: `${DAY} 15:00:00`,
  wasScheduled: 1,
  ...over,
});

/** One day of the diary, laid out — the shape both surfaces hand focus.ts. */
const dayOf = (
  activities: ScheduleActivity[],
  jobs: AllJobsMirrorJob[] = [job({ remoteId: "j-1" })],
  onSite: string[] = []
) =>
  layoutScheduleDay({
    activities,
    staff: [
      { uuid: "s-alex", name: "Alex Lorenz" },
      { uuid: "s-david", name: "David Hann" },
    ],
    jobs,
    onSite: new Set(onSite),
  });

const clock = (over: Partial<Parameters<typeof blockState>[1]> = {}) => ({
  dayISO: DAY,
  today: DAY,
  nowMin: 12 * 60,
  tracksTime: true,
  ...over,
});

describe("what one block is doing", () => {
  const blockOn = (
    activities: ScheduleActivity[],
    jobs?: AllJobsMirrorJob[],
    onSite?: string[]
  ) => dayOf(activities, jobs, onSite).lanes[0].blocks[0];

  it("goes hollow, then late, once its start has gone with nothing recorded", () => {
    const b = blockOn([act({ uuid: "a-1" })]);
    expect(blockState(b, clock())).toMatchObject({ hollow: true, late: true, word: "Nothing recorded yet" });
    // before its start it is only booked — hollow, not late
    expect(blockState(b, clock({ nowMin: 6 * 60 }))).toMatchObject({
      hollow: true,
      late: false,
      word: "Not started",
    });
  });

  it("claims nothing on a day still ahead, or on an account that never clocks on", () => {
    const b = blockOn([act({ uuid: "a-1" })]);
    // tomorrow: nothing is started yet BY DEFINITION
    expect(blockState(b, clock({ dayISO: "2026-08-15" }))).toMatchObject({
      hollow: false,
      late: false,
      word: null,
    });
    // and a crew that marks jobs complete without ever clocking on
    expect(blockState(b, clock({ tracksTime: false }))).toMatchObject({ hollow: false, word: null });
  });

  it("lets the ServiceM8 flag win — a closed booking is never also 'not started'", () => {
    const done = blockOn(
      [act({ uuid: "a-1" })],
      [job({ remoteId: "j-1", status: "Completed", completionDate: `${DAY} 16:00:00` })]
    );
    expect(blockState(done, clock())).toMatchObject({ hollow: false, late: false, word: "Done" });
    // and the same job closed BEFORE this booking is stale, not late
    const stale = blockOn(
      [act({ uuid: "a-1" })],
      [job({ remoteId: "j-1", status: "Completed", completionDate: "2026-08-12 16:00:00" })]
    );
    expect(blockState(stale, clock())).toMatchObject({
      late: false,
      word: "Marked complete in ServiceM8",
    });
  });

  it("says Started once somebody has recorded time against it", () => {
    const b = blockOn([act({ uuid: "a-1" })], undefined, ["j-1|s-alex"]);
    expect(blockState(b, clock())).toMatchObject({ hollow: false, late: false, word: "Started" });
  });
});

describe("the job brought forward", () => {
  it("gathers everyone on it off the lanes, in the paint their block wears", () => {
    const day = dayOf([
      act({ uuid: "a-1", staffUuid: "s-alex" }),
      act({ uuid: "a-2", staffUuid: "s-david", start: `${DAY} 08:00:00`, end: `${DAY} 12:00:00` }),
      /* another job on the same day — it has no business in this stack */
      act({ uuid: "a-3", jobUuid: "j-2", staffUuid: "s-david", start: `${DAY} 13:00:00` }),
    ], [job({ remoteId: "j-1" }), job({ remoteId: "j-2", jobNumber: "3171" })]);

    const focus = focusJobOf(day, "j-1", clock())!;
    expect(focus.entries.map((e) => e.who)).toEqual(["Alex Lorenz", "David Hann"]);
    expect(focus.jobNumber).toBe("3145");
    expect(focus.paint).toEqual(scheduleBlockPaint("#e7b5ff"));
    // the category leads the key, and the day-state rides behind it
    expect(focus.marks.map((m) => m.kind)).toEqual(["cat", "late"]);
    expect(focus.marks[0].word).toBe("Install");
    // a job that draws nothing here gets no card at all
    expect(focusJobOf(day, "j-nowhere", clock())).toBeNull();
  });

  it("puts a tracked job in the board's blue and names the board, not the category", () => {
    const day = layoutScheduleDay({
      activities: [act({ uuid: "a-1" })],
      staff: [{ uuid: "s-alex", name: "Alex Lorenz" }],
      jobs: [job({ remoteId: "j-1" })],
      tracked: new Map([["j-1", { kind: "project" as const, label: "Project" }]]),
    });
    const b = day.lanes[0].blocks[0];
    expect(blockPaint(b)).toEqual(TRACKED_PAINT);
    expect(blockLabel(b)).toBe("Project");
    expect(focusJobOf(day, "j-1", clock())!.marks[0].word).toBe("Project");
  });

  it("hands the sheet the DAY-state only, without its key's decode", () => {
    expect(dayStateOfMarks([{ kind: "cat", word: "Install" }])).toBeNull();
    expect(
      dayStateOfMarks([
        { kind: "cat", word: "Install" },
        { kind: "idle", word: "Not started — hollow cap" },
      ])
    ).toEqual({ kind: "idle", word: "Not started" });
  });
});
