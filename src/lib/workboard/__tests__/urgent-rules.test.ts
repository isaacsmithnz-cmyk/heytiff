/* The Urgent queue's generative rules (L1's fix), held still.

   The K2 regression lives here: an agreement created with a past due date
   MUST surface in the queue — in the prototype only fixtures could put a
   row there, so the agreements table, the calendar and the urgent screen
   told three different stories about the same visit. Rows are derived, so
   they also CLEAR by construction: same input with the fact fixed = no row. */

import { urgentRows, URGENT_GAP_WINDOW_DAYS, type UrgentVisitInput } from "../urgent-rules";

const today = "2026-07-30"; // Thursday

const visit = (over: Partial<UrgentVisitInput> = {}): UrgentVisitInput => ({
  visitId: "v-1",
  agreementId: "a-1",
  label: "Rooftop package units",
  clientName: "Halston Freight",
  siteLabel: "DC 2",
  status: "upcoming",
  dueDate: "2026-08-04",
  bookedDate: null,
  readiness: { equipment_ready: false, access_confirmed: false },
  techCount: 0,
  ...over,
});

const run = (
  visits: UrgentVisitInput[],
  flags: Parameters<typeof urgentRows>[0]["flags"] = [],
  tasks: Parameters<typeof urgentRows>[0]["tasks"] = []
) => urgentRows({ today, visits, flags, tasks });

describe("rule 1 — overdue (K2's regression pinned)", () => {
  it("a visit past its due date makes a danger row, days-over in the headline", () => {
    const rows = run([visit({ dueDate: "2026-07-21" })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reason: "overdue",
      severity: "danger",
      headline: "9 days over",
      action: "book",
      daysOver: 9,
      visitId: "v-1",
    });
  });

  it("an overdue visit that was PLACED asks to be closed out, not booked", () => {
    const rows = run([visit({ dueDate: "2026-07-28", bookedDate: "2026-07-29", status: "booked" })]);
    expect(rows[0].action).toBe("close_out");
  });

  it("due today is not overdue", () => {
    const rows = run([
      visit({ dueDate: today, readiness: { equipment_ready: true, access_confirmed: true }, techCount: 1 }),
    ]);
    expect(rows).toHaveLength(0);
  });

  it("one row per visit — overdue wins over its own gate gaps, gaps ride along as chips", () => {
    const rows = run([visit({ dueDate: "2026-07-25" })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe("overdue");
    expect(rows[0].also).toEqual(["Equipment", "Access", "Crew"]);
  });
});

describe("rules 2 and 3 — gaps inside the window", () => {
  it("missing gates inside 7 days: the LEAD gate names the row, spine order", () => {
    const rows = run([
      visit({ dueDate: "2026-08-03", readiness: { equipment_ready: false, access_confirmed: true }, techCount: 1 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reason: "gate_gap",
      severity: "warn",
      headline: "Equipment not ready",
      action: "confirm_gates",
      also: [],
    });
  });

  it("crew as the lead gap is its own reason with its own action (A12: assignment, never a tick)", () => {
    const rows = run([
      visit({ dueDate: "2026-08-03", readiness: { equipment_ready: true, access_confirmed: true }, techCount: 0 }),
    ]);
    expect(rows[0]).toMatchObject({
      reason: "no_tech",
      headline: "No technician",
      action: "assign_tech",
    });
  });

  it("secondary gaps ride along in spine order", () => {
    const rows = run([visit({ dueDate: "2026-08-03" })]);
    expect(rows[0].headline).toBe("Equipment not ready");
    expect(rows[0].also).toEqual(["Access", "Crew"]);
  });

  it("the window edge: day 7 fires, day 8 stays calm", () => {
    expect(run([visit({ dueDate: "2026-08-06" })])).toHaveLength(1);
    expect(run([visit({ dueDate: "2026-08-07" })])).toHaveLength(0);
    expect(URGENT_GAP_WINDOW_DAYS).toBe(7);
  });

  it("rows clear by construction — fix the fact and the row is gone", () => {
    const gappy = visit({ dueDate: "2026-08-03" });
    expect(run([gappy])).toHaveLength(1);
    const fixed = {
      ...gappy,
      readiness: { equipment_ready: true, access_confirmed: true },
      techCount: 1,
    };
    expect(run([fixed])).toHaveLength(0);
  });

  it("quotes and closed visits are nobody's urgency", () => {
    expect(run([visit({ dueDate: "2026-07-01", mirrorStatus: "Quote" })])).toHaveLength(0);
    expect(run([visit({ dueDate: "2026-07-01", status: "done" })])).toHaveLength(0);
    expect(run([visit({ dueDate: "2026-08-03", status: "skipped" })])).toHaveLength(0);
  });
});

describe("rules 4 and 5 — flags and tasks", () => {
  it("active flags become rows carrying their own severity", () => {
    const rows = run(
      [],
      [
        {
          flagId: "f-1",
          message: "Compressor tripping on start",
          severity: "danger",
          createdAt: "2026-07-30T01:00:00Z",
          targetKind: "visit",
          targetId: "v-9",
        },
        {
          flagId: "f-2",
          message: "Client asked for an earlier start",
          severity: "warn",
          createdAt: "2026-07-30T02:00:00Z",
          targetKind: "none",
          targetId: null,
        },
      ]
    );
    expect(rows.map((r) => r.reason)).toEqual(["flag", "flag"]);
    expect(rows[0]).toMatchObject({ severity: "danger", action: "clear_flag" });
    expect(rows[1].severity).toBe("warn");
  });

  it("tasks due today or overdue fire; future tasks don't (B20's fix)", () => {
    const rows = run(
      [],
      [],
      [
        { taskId: "t-1", title: "Order filters", dueDate: "2026-07-28", assigneeName: "Dane" },
        { taskId: "t-2", title: "Call Strata", dueDate: today, assigneeName: null },
        { taskId: "t-3", title: "Quote follow-up", dueDate: "2026-08-04", assigneeName: null },
        { taskId: "t-4", title: "No date, no fire", dueDate: null, assigneeName: null },
      ]
    );
    expect(rows.map((r) => r.taskId)).toEqual(["t-1", "t-2"]);
    expect(rows[0]).toMatchObject({ headline: "2 days over", also: ["Dane"] });
    expect(rows[1].headline).toBe("Due today");
  });
});

describe("ordering — fires first, then deterministic forever", () => {
  it("overdue (most over first) → danger flags → gaps (soonest due) → tasks → warn flags", () => {
    const rows = run(
      [
        visit({ visitId: "v-a", dueDate: "2026-07-25" }), // 5 over
        visit({ visitId: "v-b", dueDate: "2026-07-20" }), // 10 over
        visit({ visitId: "v-c", dueDate: "2026-08-05" }), // gap
        visit({ visitId: "v-d", dueDate: "2026-08-01" }), // gap, sooner
      ],
      [
        {
          flagId: "f-danger",
          message: "!",
          severity: "danger",
          createdAt: "2026-07-29T00:00:00Z",
          targetKind: "none",
          targetId: null,
        },
        {
          flagId: "f-warn",
          message: "…",
          severity: "warn",
          createdAt: "2026-07-29T00:00:00Z",
          targetKind: "none",
          targetId: null,
        },
      ],
      [{ taskId: "t-1", title: "Order filters", dueDate: "2026-07-29", assigneeName: null }]
    );
    expect(rows.map((r) => r.key)).toEqual([
      "overdue:v-b",
      "overdue:v-a",
      "flag:f-danger",
      "gate_gap:v-d",
      "gate_gap:v-c",
      "task:t-1",
      "flag:f-warn",
    ]);
  });
});
