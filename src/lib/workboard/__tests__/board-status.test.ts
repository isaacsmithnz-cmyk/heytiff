/* The status law, held still (the D14 matrix). Three surfaces disagreeing
   about one visit was the prototype's worst habit (K2); these tests pin the
   single derivation every screen reads, the canonised colour-law boundaries
   (C1: 7 and 14 days), and the calendar-week grammar the Upcoming grouping
   speaks (C4). */

import {
  completionTiming,
  daysBetween,
  dayTone,
  FLASH_WINDOW_DAYS,
  gateStateOf,
  isWeekendISO,
  missingGates,
  mondayOf,
  placementMismatch,
  rollToBusinessDay,
  SOON_WINDOW_DAYS,
  toConfirmCount,
  TO_CONFIRM_HORIZON_DAYS,
  visitTone,
  weekGroupKey,
  weekGroupRank,
  type GateState,
} from "../board-status";

const today = "2026-07-30"; // a Thursday

const gates = (equipment: boolean, access: boolean, techCount: number): GateState =>
  gateStateOf({ equipment_ready: equipment, access_confirmed: access }, techCount);

/* READY REQUIRES A DAY (Isaac, 2026-08-03), so the fixture books one by
   default — an unbooked visit is the exception now, not the baseline. */
const open = (due: string, g: GateState, status = "upcoming", bookedDate: string | null = due) => ({
  status,
  dueDate: due,
  gates: g,
  bookedDate,
});
const unbooked = (due: string, g: GateState, status = "upcoming") =>
  open(due, g, status, null);

describe("gates", () => {
  it("crew derives from assignment — one tech satisfies it, none doesn't", () => {
    expect(gates(true, true, 1)).toEqual({ equipment: true, access: true, crew: true });
    expect(gates(true, true, 0).crew).toBe(false);
    expect(gates(true, true, 3).crew).toBe(true);
  });

  it("missing gates come back in spine order: Equipment, Access, Crew", () => {
    expect(missingGates(gates(false, false, 0))).toEqual(["equipment", "access", "crew"]);
    expect(missingGates(gates(true, false, 0))).toEqual(["access", "crew"]);
    expect(missingGates(gates(true, true, 1))).toEqual([]);
  });
});

describe("visitTone — one function, all five screens", () => {
  const ready = gates(true, true, 1);
  const nothing = gates(false, false, 0);

  it("history first: done and skipped are their own tones", () => {
    expect(visitTone(open("2026-01-01", ready, "done"), today)).toBe("done");
    expect(visitTone(open("2026-01-01", nothing, "skipped"), today)).toBe("skipped");
  });

  it("a quote is not late work — mirror status 'Quote' wins over overdue", () => {
    expect(
      visitTone({ ...open("2026-07-01", nothing), mirrorStatus: "Quote" }, today)
    ).toBe("quote");
  });

  it("overdue derives from the due date — the K2 fix; no stored string exists", () => {
    expect(visitTone(open("2026-07-29", nothing), today)).toBe("over");
    // even a fully-ready visit is over once its due date has passed
    expect(visitTone(open("2026-07-29", ready), today)).toBe("over");
    // and a BOOKED one: placement is a plan, not absolution
    expect(visitTone(open("2026-07-29", ready, "booked"), today)).toBe("over");
  });

  it("due today is not overdue — the day isn't gone yet", () => {
    expect(visitTone(open(today, ready), today)).toBe("go");
  });

  it("ready is ready at any distance (green means state, not proximity)", () => {
    expect(visitTone(open(today, ready), today)).toBe("go");
    expect(visitTone(open("2026-12-24", ready), today)).toBe("go");
  });

  /* Isaac, 2026-08-03: "unless it has been booked in, it should not be ready."
     You cannot confirm ACCESS with a customer without giving them a day, so
     three ticks and an empty diary is a contradiction, not a green row. It
     falls back to the distance windows like any other unfinished visit. */
  it("three ticked gates and NO DAY is not ready — it reads by its distance", () => {
    expect(visitTone(unbooked(today, ready), today)).toBe("flash");
    expect(visitTone(unbooked("2026-08-10", ready), today)).toBe("soon");
    expect(visitTone(unbooked("2026-12-24", ready), today)).toBe("asp");
  });

  it("a booked day alone isn't ready either — the gates still have to be ticked", () => {
    expect(visitTone(open(today, nothing), today)).toBe("flash");
  });

  it("the gap windows: ≤7 flashes, 8–14 warms, beyond is fine to be open", () => {
    expect(visitTone(open(today, nothing), today)).toBe("flash"); // day 0
    expect(visitTone(open("2026-08-06", nothing), today)).toBe("flash"); // day 7
    expect(visitTone(open("2026-08-07", nothing), today)).toBe("soon"); // day 8
    expect(visitTone(open("2026-08-13", nothing), today)).toBe("soon"); // day 14
    expect(visitTone(open("2026-08-14", nothing), today)).toBe("asp"); // day 15
  });

  it("one missing gate is enough to keep a near visit out of green", () => {
    expect(visitTone(open("2026-08-02", gates(true, true, 0)), today)).toBe("flash");
  });

  it("the windows are the exported constants — the legend and the law agree", () => {
    expect(FLASH_WINDOW_DAYS).toBe(7);
    expect(SOON_WINDOW_DAYS).toBe(14);
  });
});

describe("dayTone — the cell summarises its day, worst news first", () => {
  it("an empty day is quiet; anything overdue paints it red", () => {
    expect(dayTone([], 3)).toBe("");
    expect(dayTone(["go", "over", "done"], 3)).toBe("over");
  });

  it("a day of pure history is a tick; quotes-only is a quote", () => {
    expect(dayTone(["done", "done"], -3)).toBe("done");
    expect(dayTone(["quote"], 5)).toBe("quote");
    expect(dayTone(["done", "quote"], -3)).toBe("done");
    expect(dayTone(["skipped"], -3)).toBe("");
  });

  it("every live visit ready = green day", () => {
    expect(dayTone(["go", "go", "done"], 2)).toBe("go");
  });

  it("gap days take their window from the DAY's distance", () => {
    expect(dayTone(["go", "flash"], 4)).toBe("flash");
    expect(dayTone(["soon"], 10)).toBe("soon");
    expect(dayTone(["asp"], 20)).toBe("open");
  });
});

describe("toConfirmCount — the calm-board rule (B8)", () => {
  const g = (miss: number) =>
    miss === 0 ? gates(true, true, 1) : miss === 1 ? gates(true, true, 0) : gates(false, false, 0);

  it("counts gaps only inside 14 days, and says how many services carry them", () => {
    const { gaps, services } = toConfirmCount(
      [
        open("2026-08-02", g(3)), // inside — 3 gaps
        open("2026-08-12", g(1)), // day 13 — 1 gap
        open("2026-09-20", g(3)), // September — the chip must NOT shout about this
        open("2026-08-03", g(0)), // ready — no gap
      ],
      today
    );
    expect(gaps).toBe(4);
    expect(services).toBe(2);
  });

  it("the horizon edge is day 14 in, day 15 out", () => {
    expect(toConfirmCount([open("2026-08-13", g(1))], today).gaps).toBe(1);
    expect(toConfirmCount([open("2026-08-14", g(1))], today).gaps).toBe(0);
    expect(TO_CONFIRM_HORIZON_DAYS).toBe(14);
  });

  it("overdue is the Urgent queue's news; quotes and history are nobody's gaps", () => {
    expect(toConfirmCount([open("2026-07-20", g(3))], today).gaps).toBe(0);
    expect(
      toConfirmCount([{ ...open("2026-08-02", g(3)), mirrorStatus: "Quote" }], today).gaps
    ).toBe(0);
    expect(toConfirmCount([open("2026-08-02", g(3), "done")], today).gaps).toBe(0);
  });
});

describe("dates and weekends", () => {
  it("daysBetween is calendar-honest across a DST change", () => {
    expect(daysBetween("2026-07-30", "2026-08-06")).toBe(7);
    expect(daysBetween("2026-08-06", "2026-07-30")).toBe(-7);
    // AEDT begins 2026-10-04 — the 23-hour day must still count as one
    expect(daysBetween("2026-10-03", "2026-10-05")).toBe(2);
  });

  it("weekends roll forward to Monday for display and suggestion (B11)", () => {
    expect(isWeekendISO("2026-08-01")).toBe(true); // Sat
    expect(isWeekendISO("2026-08-02")).toBe(true); // Sun
    expect(isWeekendISO("2026-08-03")).toBe(false);
    expect(rollToBusinessDay("2026-08-01")).toBe("2026-08-03");
    expect(rollToBusinessDay("2026-08-02")).toBe("2026-08-03");
    expect(rollToBusinessDay("2026-08-03")).toBe("2026-08-03");
  });
});

describe("completionTiming — 'done on time' must be earned (B12)", () => {
  it("on or before the due date is on time; after is honestly late", () => {
    expect(completionTiming("2026-07-30", "2026-07-30")).toEqual({ onTime: true, daysLate: 0 });
    expect(completionTiming("2026-07-30", "2026-07-28")).toEqual({ onTime: true, daysLate: 0 });
    expect(completionTiming("2026-07-30", "2026-08-02")).toEqual({ onTime: false, daysLate: 3 });
  });
});

describe("placementMismatch — K4's pair, surfaced never silent", () => {
  it("booking after the due date is late by construction", () => {
    expect(placementMismatch("2026-08-08", "2026-08-10")).toEqual({
      late: true,
      daysAfterDue: 2,
    });
    expect(placementMismatch("2026-08-08", "2026-08-08")).toEqual({
      late: false,
      daysAfterDue: 0,
    });
    expect(placementMismatch("2026-08-08", "2026-08-05")).toEqual({
      late: false,
      daysAfterDue: 0,
    });
  });
});

describe("week grouping (C4) — Mon–Sun weeks, overdue pulled out front", () => {
  it("mondayOf finds the week's Monday from any day of it", () => {
    expect(mondayOf("2026-07-30")).toBe("2026-07-27"); // Thu → Mon
    expect(mondayOf("2026-07-27")).toBe("2026-07-27"); // Mon → itself
    expect(mondayOf("2026-08-02")).toBe("2026-07-27"); // Sun belongs to the week it ends
  });

  it("keys: overdue, this week, next week, then Mondays", () => {
    expect(weekGroupKey("2026-07-31", today)).toBe("this_week"); // tomorrow
    expect(weekGroupKey("2026-08-02", today)).toBe("this_week"); // Sunday of this week
    expect(weekGroupKey("2026-08-03", today)).toBe("next_week");
    expect(weekGroupKey("2026-08-09", today)).toBe("next_week");
    expect(weekGroupKey("2026-08-10", today)).toBe("2026-08-10");
    expect(weekGroupKey(today, today)).toBe("this_week");
    // Monday of this week is already behind Thursday's today — that's overdue,
    // not "this week": the group order says deal with it, not plan it
    expect(weekGroupKey("2026-07-27", today)).toBe("overdue");
    expect(weekGroupKey("2026-07-20", today)).toBe("overdue");
  });

  it("ranks sort the groups in reading order", () => {
    const keys = ["2026-08-17", "next_week", "overdue", "2026-08-10", "this_week"];
    const sorted = [...keys].sort((a, b) => (weekGroupRank(a) < weekGroupRank(b) ? -1 : 1));
    expect(sorted).toEqual(["overdue", "this_week", "next_week", "2026-08-10", "2026-08-17"]);
  });
});
