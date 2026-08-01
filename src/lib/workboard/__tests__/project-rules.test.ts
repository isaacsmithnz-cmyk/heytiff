/* The projects Urgent queue's generative rules, held still.

   Same law as the maintenance side: rows derive from facts, fire iff their
   rule matches, and clear by construction when the fact changes. The board's
   one rule — nothing appears twice — is enforced by folding every
   project-level finding into ONE row per project (worst wins, the rest ride
   as chips) while visit rows stay per-trip because they're actioned
   per-trip. */

import {
  projectStateRow,
  projectUrgentRows,
  sm8BookingMismatch,
  PROJECT_STALE_DAYS,
  type ProjectRuleInput,
  type ProjectVisitRuleInput,
} from "../project-rules";

const today = "2026-07-30"; // Thursday

const project = (over: Partial<ProjectRuleInput> = {}): ProjectRuleInput => ({
  id: "p-1",
  name: "Bowden St ducted",
  clientName: "The Bowdens",
  siteLabel: "14 Bowden St",
  status: "active",
  stage: "Rough-in",
  blockedReason: null,
  blockedOn: null,
  blockedAt: null,
  promisedFinish: null,
  updatedAt: "2026-07-29T09:00:00Z",
  hoursBudget: null,
  hoursLogged: 0,
  ...over,
});

const visit = (over: Partial<ProjectVisitRuleInput> = {}): ProjectVisitRuleInput => ({
  visitId: "v-1",
  projectId: "p-1",
  projectName: "Bowden St ducted",
  clientName: "The Bowdens",
  siteLabel: "14 Bowden St",
  label: "Rough-in — day 1",
  status: "upcoming",
  dueDate: "2026-08-04",
  bookedDate: null,
  readiness: { equipment_ready: false, access_confirmed: false },
  techCount: 0,
  ...over,
});

const run = (
  projects: ProjectRuleInput[],
  visits: ProjectVisitRuleInput[] = [],
  flags: Parameters<typeof projectUrgentRows>[0]["flags"] = []
) => projectUrgentRows({ today, projects, visits, flags });

describe("blocked (P4 — first-class, reason + who)", () => {
  it("a blocked project is a danger row naming who and why", () => {
    const rows = run([
      project({
        status: "blocked",
        blockedReason: "switchboard upgrade not done",
        blockedOn: "Dave the sparky",
        blockedAt: "2026-07-25T00:00:00Z",
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reason: "blocked",
      severity: "danger",
      action: "open_project",
      headline: "Blocked on Dave the sparky — switchboard upgrade not done",
    });
  });

  it("on_hold is deliberately quiet — no row of any kind", () => {
    const stale = new Date("2026-07-01").toISOString();
    expect(run([project({ status: "on_hold", updatedAt: stale })])).toHaveLength(0);
  });
});

describe("promised finish (committed dates)", () => {
  it("a passed promise is danger while the stage is still behind", () => {
    const rows = run([project({ promisedFinish: "2026-07-27", stage: "Fit-off" })]);
    expect(rows[0]).toMatchObject({
      reason: "promise",
      severity: "danger",
      headline: "Promised finish 3 days ago — still at Fit-off",
    });
  });

  it("inside the window it counts down as a warn", () => {
    const rows = run([project({ promisedFinish: "2026-08-03", stage: "Rough-in" })]);
    expect(rows[0]).toMatchObject({
      reason: "promise",
      severity: "warn",
      headline: "Promised finish in 4 days — still at Rough-in",
    });
  });

  it("goes calm from Commission on — the finish line is in sight", () => {
    expect(run([project({ promisedFinish: "2026-07-27", stage: "Commission" })])).toHaveLength(0);
    expect(run([project({ promisedFinish: "2026-07-27", stage: "Handover" })])).toHaveLength(0);
  });

  it("beyond the window it says nothing yet", () => {
    expect(run([project({ promisedFinish: "2026-09-30" })])).toHaveLength(0);
  });
});

describe("hours burn", () => {
  it("logged past the budget is a warn with the honest numbers", () => {
    const rows = run([project({ hoursBudget: 48, hoursLogged: 52 })]);
    expect(rows[0]).toMatchObject({
      reason: "burn",
      severity: "warn",
      headline: "Over the hours budget — 52 of 48 h",
    });
  });

  it("under budget says nothing; no budget says nothing", () => {
    expect(run([project({ hoursBudget: 60, hoursLogged: 48 })])).toHaveLength(0);
    expect(run([project({ hoursBudget: null, hoursLogged: 400 })])).toHaveLength(0);
  });
});

describe("stale", () => {
  it(`no movement for ${PROJECT_STALE_DAYS} days is a warn`, () => {
    const rows = run([project({ updatedAt: "2026-07-16T08:00:00Z" })]);
    expect(rows[0]).toMatchObject({ reason: "stale", severity: "warn" });
    expect(rows[0].headline).toBe("No movement for 14 days");
  });

  it("a blocked project doesn't ALSO nag about being quiet as its lead", () => {
    const rows = run([
      project({
        status: "blocked",
        blockedReason: "permit",
        blockedOn: "council",
        updatedAt: "2026-07-01T08:00:00Z",
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe("blocked");
  });
});

describe("one row per project — worst wins, the rest ride as chips", () => {
  it("blocked + passed promise + burn = one danger row with two chips", () => {
    const rows = run([
      project({
        status: "blocked",
        blockedReason: "permit",
        blockedOn: "council",
        promisedFinish: "2026-07-20",
        stage: "Fit-off",
        hoursBudget: 40,
        hoursLogged: 44,
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe("blocked");
    expect(rows[0].also).toEqual(["Promise passed", "44 of 40 h"]);
  });

  it("projectStateRow is the same verdict the detail page reads", () => {
    const p = project({ hoursBudget: 48, hoursLogged: 52 });
    expect(projectStateRow(p, today)?.reason).toBe("burn");
    expect(projectStateRow(project(), today)).toBeNull();
  });
});

describe("visit rows", () => {
  it("an overdue trip is danger; placed asks 'did it run?', unplaced asks 'book it'", () => {
    const rows = run(
      [project()],
      [
        visit({ visitId: "v-1", dueDate: "2026-07-21" }),
        visit({ visitId: "v-2", dueDate: "2026-07-25", bookedDate: "2026-07-25" }),
      ]
    );
    expect(rows.map((r) => [r.reason, r.action])).toEqual([
      ["visit_overdue", "book"],
      ["visit_overdue", "close_out"],
    ]);
    expect(rows[0].label).toBe("Bowden St ducted · Rough-in — day 1");
  });

  it("gate gaps fire only inside the window, lead gate in spine order", () => {
    const rows = run(
      [project()],
      [visit({ dueDate: "2026-08-04", techCount: 1 })] // equipment+access missing, crew ok
    );
    expect(rows[0]).toMatchObject({
      reason: "gate_gap",
      leadGate: "equipment",
      action: "confirm_gates",
      also: ["Access"],
    });
    expect(
      run([project()], [visit({ dueDate: "2026-09-01" })])
    ).toHaveLength(0);
  });

  it("crew-only gap names the tech ask", () => {
    const rows = run(
      [project()],
      [
        visit({
          dueDate: "2026-08-03",
          readiness: { equipment_ready: true, access_confirmed: true },
          techCount: 0,
        }),
      ]
    );
    expect(rows[0]).toMatchObject({ reason: "no_tech", action: "assign_tech" });
  });

  it("a held or finished project's trips are parked with it", () => {
    const held = project({ id: "p-9", status: "on_hold" });
    const done = project({ id: "p-8", status: "done" });
    const rows = run(
      [held, done],
      [
        visit({ visitId: "v-8", projectId: "p-9", dueDate: "2026-07-01" }),
        visit({ visitId: "v-9", projectId: "p-8", dueDate: "2026-07-01" }),
      ]
    );
    expect(rows).toHaveLength(0);
  });
});

describe("ordering", () => {
  it("overdue trips, then blocked projects, then gaps, then warn project rows, then warn flags", () => {
    const rows = projectUrgentRows({
      today,
      projects: [
        project({ id: "p-2", name: "Warehouse VRF", status: "blocked", blockedReason: "crane", blockedOn: "builder" }),
        project({ id: "p-3", name: "Quiet one", updatedAt: "2026-07-10T00:00:00Z" }),
        project(),
      ],
      visits: [
        visit({ visitId: "v-1", dueDate: "2026-07-25" }),
        visit({ visitId: "v-2", dueDate: "2026-08-02", techCount: 1 }),
      ],
      flags: [
        { flagId: "f-1", message: "Left the vac pump on site", severity: "warn", createdAt: "2026-07-29T10:00:00Z" },
      ],
    });
    expect(rows.map((r) => r.reason)).toEqual([
      "visit_overdue",
      "blocked",
      "gate_gap",
      "stale",
      "flag",
    ]);
  });
});

describe("sm8BookingMismatch (show + chip, never auto-write)", () => {
  it("agrees, differs, or knows something we haven't placed", () => {
    expect(sm8BookingMismatch("2026-08-04", "2026-08-04 07:30:00")).toBe("none");
    expect(sm8BookingMismatch("2026-08-04", "2026-08-06 07:30:00")).toBe("differs");
    expect(sm8BookingMismatch(null, "2026-08-06 07:30:00")).toBe("diary_only");
    expect(sm8BookingMismatch(null, null)).toBe("none");
    expect(sm8BookingMismatch("2026-08-04", null)).toBe("none");
  });
});
