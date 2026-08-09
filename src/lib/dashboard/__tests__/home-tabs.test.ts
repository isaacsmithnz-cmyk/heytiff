import { allClear, homeTabs } from "../home-tabs";
import { sortChips, type ActionChip } from "../chips";

/* The five tab badges. What's worth pinning: urgent and needs-attention split
   ONE chip list on state, so the two can't double-count a thing or drop one
   between them; the badge is ABSENT at zero rather than showing a grey 0; and
   only the two tabs whose count means severity carry a tone, because red and
   amber have to keep meaning "something is wrong". */

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

const by = (tabs: ReturnType<typeof homeTabs>, key: string) => tabs.find((t) => t.key === key)!;

describe("homeTabs", () => {
  it("splits the chips into urgent (past) and needs attention (due soon)", () => {
    const tabs = homeTabs({
      chips: sortChips([chip("bad", "a"), chip("warn", "b"), chip("warn", "c")]),
      openTasks: 0,
      unreadNotices: 0,
    });

    expect(by(tabs, "urgent").count).toBe(1);
    expect(by(tabs, "attention").count).toBe(2);
    // every chip lands in exactly one of the two badges
    expect(by(tabs, "urgent").count! + by(tabs, "attention").count!).toBe(3);
  });

  it("counts the viewer's open tasks and unread notices", () => {
    const tabs = homeTabs({ chips: [], openTasks: 4, unreadNotices: 2 });
    expect(by(tabs, "tasks").count).toBe(4);
    expect(by(tabs, "board").count).toBe(2);
  });

  it("keeps all five faces on a clear day, Journal first", () => {
    const tabs = homeTabs({ chips: [], openTasks: 0, unreadNotices: 0 });
    expect(tabs.map((t) => t.key)).toEqual(["journal", "urgent", "attention", "board", "tasks"]);
  });

  it("shows NO badge at zero — a grey 0 on every tab is noise", () => {
    /* The counters this replaced rendered a dimmed tile at zero so that
       "checked, nothing there" stayed distinct from "didn't check". A tab has
       a body behind it that says the same thing in words, so the badge can go
       rather than sit there saying nothing five times. */
    const tabs = homeTabs({ chips: [], openTasks: 0, unreadNotices: 0 });
    expect(tabs.every((t) => !t.count)).toBe(true);
  });

  it("tones ONLY the two badges that mean severity", () => {
    const tabs = homeTabs({
      chips: sortChips([chip("bad", "a"), chip("warn", "b")]),
      openTasks: 3,
      unreadNotices: 1,
    });
    expect(by(tabs, "urgent").tone).toBe("dan");
    expect(by(tabs, "attention").tone).toBe("warn");
    // places and work, not states — they take the plain grey badge
    expect(by(tabs, "board").tone).toBeUndefined();
    expect(by(tabs, "tasks").tone).toBeUndefined();
  });

  it("never badges the tab you land on", () => {
    // Journal is the default face; a count on it counts what you're looking at
    const tabs = homeTabs({ chips: [], openTasks: 9, unreadNotices: 9 });
    expect(by(tabs, "journal").count).toBeUndefined();
  });
});

describe("allClear", () => {
  it("is true only when every badge is absent", () => {
    expect(allClear(homeTabs({ chips: [], openTasks: 0, unreadNotices: 0 }))).toBe(true);
  });

  it("is false when any ONE counter has something in it", () => {
    const cases = [
      { chips: [chip("warn", "a")], openTasks: 0, unreadNotices: 0 },
      { chips: [], openTasks: 1, unreadNotices: 0 },
      { chips: [], openTasks: 0, unreadNotices: 1 },
    ];
    for (const c of cases) expect(allClear(homeTabs(c))).toBe(false);
  });

  /* The one that would bite: no expiries, but tasks waiting. "All clear" is
     true of the action-required board and false of the person reading it. */
  it("is false with a clean compliance board but open tasks", () => {
    expect(allClear(homeTabs({ chips: [], openTasks: 3, unreadNotices: 0 }))).toBe(false);
  });
});
