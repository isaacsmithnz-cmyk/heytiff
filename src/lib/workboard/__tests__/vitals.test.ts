/* The rules behind the Workboard's three numbers. These are the assertions
   that stop "urgent" quietly drifting to mean something else. */

import {
  ATTENTION_WINDOW_DAYS,
  maintenanceVitals,
  mondayOf,
  projectFlag,
  projectVitals,
  radarLoad,
  stageFunnel,
  staleDays,
  weekBuckets,
  type LoadItem,
} from "../vitals";
import { PROJECT_STAGES } from "../stages";
import type { RadarItem } from "../maintenance-query";
import type { ProjectStripItem } from "../projects-query";

const TODAY = "2026-07-29"; // a Wednesday

function visit(over: Partial<RadarItem> & { visitId: string; dueDate: string }): RadarItem {
  return {
    agreementId: "ag-1",
    label: "Quarterly service",
    clientName: "Ardex",
    siteLabel: null,
    bucket: over.dueDate < TODAY ? "overdue" : "upcoming",
    status: "upcoming",
    ready: 2,
    readyTotal: 2,
    readiness: {
      equipment_ready: true,
      access_confirmed: true,
    },
    jobNumber: null,
    bookedStart: null,
    ...over,
  };
}

function project(over: Partial<ProjectStripItem> & { id: string }): ProjectStripItem {
  return {
    name: "Harbour View Rd",
    clientName: "Ardex",
    siteLabel: null,
    stage: "Fit-off",
    status: "active",
    percent: 50,
    done: 7,
    total: 14,
    updatedAt: `${TODAY}T02:00:00Z`,
    ...over,
  };
}

describe("maintenanceVitals", () => {
  it("counts overdue as urgent and names the oldest breach", () => {
    const v = maintenanceVitals(
      [
        visit({ visitId: "v1", dueDate: "2026-07-20", bucket: "overdue" }),
        visit({ visitId: "v2", dueDate: "2026-07-27", bucket: "overdue" }),
        visit({ visitId: "v3", dueDate: "2026-08-15" }),
      ],
      TODAY
    );
    expect(v.urgent.map((r) => r.visitId)).toEqual(["v1", "v2"]);
    expect(v.tiles[0].count).toBe(2);
    expect(v.tiles[0].caption).toBe("Oldest is 9 days over"); // 20 July → 29 July
    expect(v.tiles[0].tone).toBe("urgent");
  });

  it("goes calm, not red, when nothing has slipped", () => {
    const v = maintenanceVitals([visit({ visitId: "v1", dueDate: "2026-08-15" })], TODAY);
    expect(v.tiles[0].count).toBe(0);
    expect(v.tiles[0].tone).toBe("calm");
    expect(v.tiles[0].caption).toBe("Nothing has slipped");
  });

  it("flags a near visit only when prep is actually missing", () => {
    const prepped = visit({ visitId: "ready", dueDate: "2026-07-30", ready: 2, readyTotal: 2 });
    const bare = visit({ visitId: "bare", dueDate: "2026-07-30", ready: 1, readyTotal: 2 });
    const v = maintenanceVitals([prepped, bare], TODAY);
    // Due tomorrow and fully prepped is not a problem — it's a job.
    expect(v.attention.map((r) => r.visitId)).toEqual(["bare"]);
    expect(v.tiles[1].caption).toBe("1 of 2 checks ticked");
  });

  it("holds the attention window at exactly 14 days", () => {
    const inside = visit({
      visitId: "in",
      dueDate: "2026-08-12", // +14
      ready: 0,
      readyTotal: 2,
    });
    const outside = visit({
      visitId: "out",
      dueDate: "2026-08-13", // +15
      ready: 0,
      readyTotal: 2,
    });
    expect(ATTENTION_WINDOW_DAYS).toBe(14);
    const v = maintenanceVitals([inside, outside], TODAY);
    expect(v.attention.map((r) => r.visitId)).toEqual(["in"]);
  });

  it("never counts an overdue visit twice", () => {
    const v = maintenanceVitals(
      [visit({ visitId: "v1", dueDate: "2026-07-20", bucket: "overdue", ready: 0 })],
      TODAY
    );
    expect(v.urgent).toHaveLength(1);
    expect(v.attention).toHaveLength(0);
  });

  it("counts the distinct agreements behind the radar, not the visits", () => {
    const v = maintenanceVitals(
      [
        visit({ visitId: "v1", dueDate: "2026-08-01", agreementId: "a" }),
        visit({ visitId: "v2", dueDate: "2026-09-01", agreementId: "a" }),
        visit({ visitId: "v3", dueDate: "2026-08-05", agreementId: "b" }),
      ],
      TODAY
    );
    expect(v.tiles[2].count).toBe(3);
    expect(v.tiles[2].caption).toContain("Across 2 agreements");
  });
});

describe("projectFlag", () => {
  it("treats on hold as urgent however recently it moved", () => {
    const p = project({ id: "p1", status: "on_hold", updatedAt: `${TODAY}T08:00:00Z` });
    expect(projectFlag(p, TODAY)).toEqual({ tone: "urgent", reason: "On hold" });
  });

  it("escalates by silence: 6 days fine, 7 attention, 14 urgent", () => {
    const at = (days: number) =>
      projectFlag(project({ id: "p", updatedAt: `2026-07-${29 - days}T09:00:00Z` }), TODAY).tone;
    expect(at(6)).toBeNull();
    expect(at(7)).toBe("attention");
    expect(at(13)).toBe("attention");
    expect(at(14)).toBe("urgent");
  });

  it("says why, so the colour is actionable", () => {
    const p = project({ id: "p1", updatedAt: "2026-07-18T09:00:00Z" });
    expect(projectFlag(p, TODAY).reason).toBe("No movement for 11 days");
  });

  it("reads a project that has never moved as stale, not fresh", () => {
    expect(staleDays(project({ id: "p", updatedAt: null }), TODAY)).toBe(0);
    expect(staleDays(project({ id: "p", updatedAt: "not-a-date" }), TODAY)).toBe(0);
  });
});

describe("projectVitals", () => {
  it("partitions by flag and names the busiest stage", () => {
    const v = projectVitals(
      [
        project({ id: "a", stage: "Fit-off" }),
        project({ id: "b", stage: "Fit-off", updatedAt: "2026-07-20T09:00:00Z" }), // 9 days
        project({ id: "c", stage: "Commission", status: "on_hold" }),
      ],
      TODAY
    );
    expect(v.urgent.map((p) => p.id)).toEqual(["c"]);
    expect(v.attention.map((p) => p.id)).toEqual(["b"]);
    expect(v.tiles[2].count).toBe(3);
    expect(v.tiles[2].caption).toBe("2 in Fit-off");
  });

  it("is calm and quiet on an empty board", () => {
    const v = projectVitals([], TODAY);
    expect(v.tiles.map((t) => t.count)).toEqual([0, 0, 0]);
    expect(v.tiles.every((t) => t.tone === "calm")).toBe(true);
    expect(v.tiles[2].caption).toBe("Nothing on the go");
  });
});

describe("weekBuckets", () => {
  const item = (id: string, date: string): LoadItem => ({ id, date, label: id, state: "ready" });

  it("puts anything before today in Overdue, not in week 0", () => {
    const b = weekBuckets([item("late", "2026-07-27")], TODAY); // same week, but past
    expect(b[0].key).toBe("overdue");
    expect(b[0].items.map((i) => i.id)).toEqual(["late"]);
    expect(b[1].items).toHaveLength(0);
  });

  it("lands today and the rest of this week in the first column", () => {
    const b = weekBuckets([item("now", TODAY), item("fri", "2026-07-31")], TODAY);
    expect(b[1].label).toBe("This week");
    expect(b[1].items.map((i) => i.id)).toEqual(["now", "fri"]);
  });

  it("keeps Sunday in the week that started six days earlier", () => {
    // 2 Aug 2026 is a Sunday — the classic off-by-one that jumps a column.
    expect(mondayOf("2026-08-02")).toBe("2026-07-27");
    const b = weekBuckets([item("sun", "2026-08-02")], TODAY);
    expect(b[1].items.map((i) => i.id)).toEqual(["sun"]);
  });

  it("gives 8 forward columns plus Overdue, and drops what's past the horizon", () => {
    const b = weekBuckets([item("far", "2026-11-30")], TODAY);
    expect(b).toHaveLength(9);
    expect(b.every((x) => x.items.length === 0)).toBe(true);
  });

  it("counts a heavy week honestly", () => {
    const b = weekBuckets(
      [item("a", "2026-08-10"), item("b", "2026-08-12"), item("c", "2026-08-14")],
      TODAY
    );
    expect(b[3].items).toHaveLength(3); // overdue, this week, next week, then w/c 10 Aug
  });
});

describe("radarLoad", () => {
  it("colours by breach first, then by prep", () => {
    const states = radarLoad([
      visit({ visitId: "v1", dueDate: "2026-07-20", bucket: "overdue", ready: 2 }),
      visit({ visitId: "v2", dueDate: "2026-08-05", ready: 1, readyTotal: 2 }),
      visit({ visitId: "v3", dueDate: "2026-08-06", ready: 2, readyTotal: 2 }),
    ]).map((i) => i.state);
    expect(states).toEqual(["overdue", "attention", "ready"]);
  });
});

describe("stageFunnel", () => {
  it("gives every stage a column, empty ones included", () => {
    const cols = stageFunnel([project({ id: "a", stage: "Fit-off" })], PROJECT_STAGES, TODAY);
    expect(cols).toHaveLength(PROJECT_STAGES.length);
    expect(cols.find((c) => c.stage === "Fit-off")?.items).toHaveLength(1);
    expect(cols.find((c) => c.stage === "Quote")?.items).toHaveLength(0);
  });

  it("takes the worst flag in the column, so trouble shows through volume", () => {
    const cols = stageFunnel(
      [
        project({ id: "ok", stage: "Commission" }),
        project({ id: "held", stage: "Commission", status: "on_hold" }),
      ],
      PROJECT_STAGES,
      TODAY
    );
    expect(cols.find((c) => c.stage === "Commission")?.tone).toBe("urgent");
  });
});
