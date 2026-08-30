import { homeTabs } from "../home-tabs";

/* The three tab badges. What's worth pinning: only Tasks can carry a number,
   because it is the only face that can want you; that number goes RED only
   when something is past its date, because red on this app means something is
   wrong; and the badge is absent at zero rather than showing a grey nought.

   Urgent, Needs attention and Noticeboard used to be faces of this card with
   badges of their own. They are chips in the page head now, pointing at the
   screens that hold them in full — see home.tsx. */

const by = (tabs: ReturnType<typeof homeTabs>, key: string) => tabs.find((t) => t.key === key)!;

describe("homeTabs", () => {
  it("is Diary, Tasks, Debrief, Calendar — in that order, Diary first", () => {
    const tabs = homeTabs({ openTasks: 0, overdueTasks: 0 });
    expect(tabs.map((t) => t.key)).toEqual(["diary", "tasks", "debrief", "calendar"]);
  });

  it("counts the viewer's open tasks", () => {
    const tabs = homeTabs({ openTasks: 4, overdueTasks: 0 });
    expect(by(tabs, "tasks").count).toBe(4);
    expect(by(tabs, "tasks").tone).toBeUndefined();
    expect(by(tabs, "tasks").countLabel!(4)).toBe("4 open");
  });

  it("turns the badge red and counts the OVERDUE ones once anything is late", () => {
    /* The number changes meaning with its colour, deliberately: a red 2 beside
       six open tasks says "two of these are late", which is the thing that
       wants you. A grey 6 says how much work there is, which does not. */
    const tabs = homeTabs({ openTasks: 6, overdueTasks: 2 });
    expect(by(tabs, "tasks").count).toBe(2);
    expect(by(tabs, "tasks").tone).toBe("dan");
    expect(by(tabs, "tasks").countLabel!(2)).toBe("2 past their date");
  });

  it("says 'its date' for one and 'their date' for more", () => {
    const one = homeTabs({ openTasks: 3, overdueTasks: 1 });
    expect(by(one, "tasks").countLabel!(1)).toBe("1 past its date");
  });

  it("shows NO badge at zero — a grey 0 on every tab is noise", () => {
    const tabs = homeTabs({ openTasks: 0, overdueTasks: 0 });
    expect(tabs.every((t) => !t.count)).toBe(true);
  });

  it("never badges Diary, Debrief or Calendar, whatever else is going on", () => {
    /* Diary is where you land, so a number on it counts what you are already
       reading. Debrief is a door to a conversation, and a count on a
       conversation is not a thing that exists. A number on Calendar would
       count people being off, which is not something that needs you — and
       red or amber there would make leave look like a problem. */
    const tabs = homeTabs({ openTasks: 9, overdueTasks: 4 });
    expect(by(tabs, "diary").count).toBeUndefined();
    expect(by(tabs, "debrief").count).toBeUndefined();
    expect(by(tabs, "debrief").tone).toBeUndefined();
    expect(by(tabs, "calendar").count).toBeUndefined();
    expect(by(tabs, "calendar").tone).toBeUndefined();
  });
});
