import { allClear, heroStats } from "../hero-stats";
import { sortChips, type ActionChip } from "../chips";

/* The hero's four counters. What's worth pinning: urgent and needs-attention
   split ONE chip list on state, so the two tiles can't double-count a thing or
   drop one between them, and every tile survives at zero. */

function chip(state: "bad" | "warn", key: string): ActionChip {
  return {
    key,
    kind: "rego",
    state,
    label: state === "bad" ? "Rego expired 4 days ago" : "Rego expires in 2 weeks",
    subject: "Ute",
    href: "/dashboard/assets",
    urgency: state === "bad" ? -4 : 10_014,
  };
}

const by = (stats: ReturnType<typeof heroStats>, key: string) =>
  stats.find((s) => s.key === key)!;

describe("heroStats", () => {
  it("splits the chips into urgent (past) and needs attention (due soon)", () => {
    const stats = heroStats({
      chips: sortChips([chip("bad", "a"), chip("warn", "b"), chip("warn", "c")]),
      openTasks: 0,
      unreadNotices: 0,
    });

    expect(by(stats, "urgent").count).toBe(1);
    expect(by(stats, "attention").count).toBe(2);
    // every chip lands in exactly one of the two tiles
    expect(by(stats, "urgent").count + by(stats, "attention").count).toBe(3);
  });

  it("counts the viewer's open tasks and unread notices", () => {
    const stats = heroStats({ chips: [], openTasks: 4, unreadNotices: 2 });
    expect(by(stats, "tasks").count).toBe(4);
    expect(by(stats, "notices").count).toBe(2);
  });

  it("returns all four tiles on a clear day — zero means checked, not missing", () => {
    const stats = heroStats({ chips: [], openTasks: 0, unreadNotices: 0 });
    expect(stats.map((s) => s.key)).toEqual(["urgent", "tasks", "attention", "notices"]);
    expect(stats.every((s) => s.count === 0)).toBe(true);
  });

  it("sends each tile to the screen that owns it", () => {
    const stats = heroStats({ chips: [], openTasks: 0, unreadNotices: 0 });
    expect(by(stats, "urgent").href).toBe("/dashboard/action-required");
    expect(by(stats, "attention").href).toBe("/dashboard/action-required");
    expect(by(stats, "notices").href).toBe("/dashboard/notices");
    // tasks are ON this page, so the tile scrolls rather than navigates
    expect(by(stats, "tasks").href).toBe("#dash-tasks");
  });
});

describe("allClear", () => {
  it("is true only when every counter is zero", () => {
    expect(allClear(heroStats({ chips: [], openTasks: 0, unreadNotices: 0 }))).toBe(true);
  });

  it("is false when any ONE counter has something in it", () => {
    const cases = [
      { chips: [chip("warn", "a")], openTasks: 0, unreadNotices: 0 },
      { chips: [], openTasks: 1, unreadNotices: 0 },
      { chips: [], openTasks: 0, unreadNotices: 1 },
    ];
    for (const c of cases) expect(allClear(heroStats(c))).toBe(false);
  });

  /* The one that would bite: no expiries, but tasks waiting. "All clear" is
     true of the action-required board and false of the person reading it. */
  it("is false with a clean compliance board but open tasks", () => {
    expect(allClear(heroStats({ chips: [], openTasks: 3, unreadNotices: 0 }))).toBe(false);
  });
});
