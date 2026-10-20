/* A JOB'S OVERVIEW AS ITS CONVERSATION (v2, step 6), the pure half: the
   order and the days, what a note made, and the rail's three groups. */

import {
  conversationDays,
  dayLabel,
  madeCards,
  nextVisitOf,
  railTasksOf,
  repliesOf,
  stampClock,
  taskLine,
  talkWithoutMoney,
  whereUpTo,
  withoutMoney,
  type JobNoteTalk,
} from "../job-conversation";
import type { StoryEntry } from "@/lib/workboard/job-story";
import type { BookedEntry } from "@/lib/workboard/all-jobs-query";
import { appliedOf } from "@/lib/workboard/note-applied";

const note = (key: string, day: string, at: string, extra: Partial<Extract<StoryEntry, { kind: "note" }>> = {}): StoryEntry => ({
  kind: "note",
  key,
  day,
  at,
  author: "Lyle Irving",
  text: key,
  actionRequired: false,
  fromClaim: null,
  origin: "servicem8",
  id: null,
  ...extra,
});

const talk = (id: string, stamp: string, extra: Partial<JobNoteTalk> = {}): JobNoteTalk => ({
  id,
  authorId: "s-isaac",
  authorName: "Isaac Smith",
  said: `said ${id}`,
  stamp,
  day: stamp.slice(0, 10),
  spoken: false,
  replies: [],
  made: [],
  undo: false,
  undone: false,
  ...extra,
});

describe("the conversation's order and its days", () => {
  /* the diary's list arrives newest first */
  const story: StoryEntry[] = [
    note("ournote:n2", "2026-10-13", "2026-10-13 10:05:00", { origin: "heytiff", id: "n2" }),
    note("note:b", "2026-10-13", "2026-10-13 10:02:00"),
    { kind: "milestone", key: "m:wo", day: "2026-10-12", at: null, label: "Became a work order" },
    note("note:a", "2026-10-12", "2026-10-12 15:00:00"),
  ];

  it("reads oldest first, with a line between the days, today's called Today", () => {
    const days = conversationDays(story, [], "2026-10-13");
    expect(days.map((d) => d.label)).toEqual(["Yesterday", "Today"]);
    expect(days.map((d) => d.items.map((i) => i.key))).toEqual([
      ["note:a", "m:wo"],
      ["note:b", "ournote:n2"],
    ]);
  });

  it("names an older day by its weekday and date", () => {
    expect(dayLabel("2026-10-09", "2026-10-13")).toBe("Fri 9 Oct");
    expect(dayLabel("2026-10-09", null)).toBe("Fri 9 Oct");
  });

  it("gives one of our notes what Tiff said back to it", () => {
    const t = talk("n2", "2026-10-13 10:05", { replies: [{ who: "tiff", text: "Done. A task for Lyle." }] });
    const days = conversationDays(story, [t], "2026-10-13");
    expect(days[1]!.items[1]!.talk).toBe(t);
  });

  it("stands a note Undo took back where its stamp puts it, from its talk alone", () => {
    const gone = talk("n9", "2026-10-13 10:03", { undone: true, replies: [{ who: "tiff", text: "1 task taken back." }] });
    const days = conversationDays(story, [gone], "2026-10-13");
    expect(days[1]!.items.map((i) => i.key)).toEqual(["note:b", "talk:n9", "ournote:n2"]);
    expect(days[1]!.items[1]!.entry).toBeNull();
  });

  it("leaves out what the box just said, which the live conversation draws, and taken-back notes under another filter", () => {
    const gone = talk("n9", "2026-10-13 10:03", { undone: true });
    const days = conversationDays(story, [gone], "2026-10-13", new Set(["n2"]), false);
    expect(days[1]!.items.map((i) => i.key)).toEqual(["note:b"]);
  });

  it("reads a clock off a naive stamp", () => {
    expect(stampClock("2026-10-13 10:05:12")).toBe("10:05 am");
    expect(stampClock("2026-10-13 14:30")).toBe("2:30 pm");
    expect(stampClock(null)).toBe("");
  });
});

describe("what a note made", () => {
  it("is a card per thing, the words kept on the job being the message itself", () => {
    const record = appliedOf({
      v: 2,
      taskIds: ["t1", "t-gone"],
      flagIds: ["f1"],
      jobNotes: ["Get Lyle to order the grilles"],
      bringItems: ["Grille"],
    });
    const cards = madeCards(record, {
      tasks: new Map([["t1", { title: "Order the grilles", line: "Lyle, today by 12:30 pm" }]]),
      flags: new Map([["f1", { message: "Isolator on the deck", active: true }]]),
      issues: new Map(),
    });
    expect(cards.map((c) => [c.kind, c.name, c.line])).toEqual([
      ["task", "Order the grilles", "Lyle, today by 12:30 pm"],
      ["gone", "1 task", "Removed since"],
      ["flag", "Isolator on the deck", "A flag on the job"],
      ["bring", "Grille", "To bring"],
    ]);
  });

  it("says Done. under a note that made something before Tiff talked back", () => {
    expect(repliesOf([], 1)).toEqual([{ who: "tiff", text: "Done." }]);
    expect(repliesOf([], 0)).toEqual([]);
    expect(
      repliesOf(
        [
          { who: "you", text: "Get Lyle to order the grilles" },
          { who: "tiff", text: "Done. A task for Lyle." },
        ],
        1,
      ),
    ).toEqual([{ who: "tiff", text: "Done. A task for Lyle." }]);
  });

  it("says a task's who and when in a line", () => {
    expect(taskLine({ who: "Lyle", dueDate: "2026-10-13", time: "12:30 pm", by: true }, "2026-10-13")).toBe("Lyle, today by 12:30 pm");
    expect(taskLine({ who: "Lyle", dueDate: "2026-10-16", time: null, by: false }, "2026-10-13")).toBe("Lyle, Fri 16 Oct");
    expect(taskLine({ who: null, dueDate: "2026-10-14", time: null, by: false }, "2026-10-13")).toBe("Tomorrow");
    expect(taskLine({ who: null, dueDate: null, time: null, by: false }, "2026-10-13")).toBe("Nobody on it yet");
    expect(taskLine({ who: "Lyle", dueDate: null, time: null, by: false, done: true }, null)).toBe("Lyle. Done");
  });
});

describe("the rail", () => {
  it("says where the job is up to as one paragraph", () => {
    expect(
      whereUpTo({ lead: "On site", points: ["Day 1 of 1", "Both heads in."], stamp: "", eventOn: null, eventLabel: null }),
    ).toBe("Day 1 of 1. Both heads in.");
    expect(whereUpTo({ lead: "Waiting on the quote.", points: [], stamp: "", eventOn: null, eventLabel: null })).toBe("Waiting on the quote.");
    expect(whereUpTo(null)).toBeNull();
  });

  it("lists the job's open tasks once each, soonest due first", () => {
    const row = (id: string, dueDate: string | null, status = "open") => ({ id, title: id, status, dueDate, line: "", assigneeId: null });
    expect(railTasksOf([row("a", null), row("b", "2026-10-14"), row("c", "2026-10-13"), row("b", "2026-10-14"), row("d", "2026-10-12", "done")]).map((t) => t.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  const booked = (start: string, staffName: string, extra: Partial<BookedEntry> = {}): BookedEntry => ({
    uuid: `${start}-${staffName}`,
    staffUuid: null,
    staffName,
    staffTitle: null,
    start,
    end: null,
    ourRow: null,
    leftover: false,
    bookedOn: "2026-10-10",
    ...extra,
  });

  it("says the next visit's day, time and crew", () => {
    const next = nextVisitOf(
      { booked: [booked("2026-10-16 14:00:00", "Lyle Irving", { end: "2026-10-16 16:00:00" }), booked("2026-10-16 14:00:00", "Dane Hill", { end: "2026-10-16 16:00:00" })] },
      "2026-10-13",
    );
    expect(next).toEqual({ when: "Fri 16 Oct, 2:00 pm", who: "Lyle Irving and Dane Hill", state: null });
  });

  it("says in orange when the visit's time is still to confirm, or ServiceM8 doesn't have it yet", () => {
    expect(nextVisitOf({ booked: [booked("2026-10-16 00:00:00", "Lyle Irving")] }, "2026-10-13")?.state).toEqual({ word: "Time to confirm", tone: "look" });
    expect(
      nextVisitOf({ booked: [booked("2026-10-14 07:00:00", "Lyle Irving", { end: "2026-10-14 15:00:00", ourRow: "w1", bookedOn: null })] }, "2026-10-13"),
    ).toEqual({ when: "Tomorrow, 7:00 am", who: "Lyle Irving", state: { word: "Not in ServiceM8 yet", tone: "look" } });
  });

  it("reads the detail's next booking where the deployment doesn't book, and nothing for a leftover", () => {
    expect(nextVisitOf({ nextBooking: { start: "2026-10-13 07:30:00", end: "2026-10-13 12:00:00", staffName: "Lyle Irving" } }, "2026-10-13")?.when).toBe("Today, 7:30 am");
    expect(nextVisitOf({ booked: [booked("2026-10-16 14:00:00", "Lyle Irving", { leftover: true })] }, "2026-10-13")).toBeNull();
    expect(nextVisitOf({ booked: [] }, "2026-10-13")).toBeNull();
  });
});

describe("withoutMoney (decision 15)", () => {
  it("says a cost at a supplier as a cost there, and any other figure as an amount", () => {
    expect(withoutMoney("Claimed: $85.00 at Reece, fittings. It's waiting on approval.")).toBe(
      "Claimed: a cost at Reece, fittings. It's waiting on approval.",
    );
    expect(withoutMoney("On the company card: $1,240.50 at Rexel, cable.")).toBe("On the company card: a cost at Rexel, cable.");
    expect(withoutMoney("$85.00 at Reece taken back.")).toBe("A cost at Reece taken back.");
    expect(withoutMoney("The quote's total is $12,400 inc GST, and the deposit $3,720.")).toBe(
      "The quote's total is an amount, and the deposit an amount.",
    );
    expect(withoutMoney("Option 2 comes to 9,800 dollars.")).toBe("Option 2 comes to an amount.");
  });

  it("drops the sentence that only gives the receipt's figure", () => {
    expect(withoutMoney("Claimed: $92.40 at Reece. The receipt says $92.40, so that's what I used.")).toBe("Claimed: a cost at Reece.");
  });

  it("says a margin without its figure", () => {
    expect(withoutMoney("Priced at a 32% margin.")).toBe("Priced at a margin.");
    expect(withoutMoney("Profit is 18.5%.")).toBe("Profit is an amount.");
  });

  it("leaves words with no money in them as they were", () => {
    for (const s of ["A task for Lyle.", "Book commissioning for 2:00 pm on the 16th", "3 grilles, 2 heads"]) expect(withoutMoney(s)).toBe(s);
  });

  it("rewrites Tiff's side of a note and keeps the speaker's words as typed", () => {
    const t: JobNoteTalk = {
      id: "n1",
      authorId: "s1",
      authorName: "Isaac Smith",
      said: "$85 at Reece for fittings",
      stamp: "2026-10-13 10:05",
      day: "2026-10-13",
      spoken: false,
      replies: [
        { who: "tiff", text: "How much was it: fittings at Reece? I have $85." },
        { who: "you", text: "$85 inc" },
      ],
      made: [{ key: "task:t1", kind: "task", name: "Claim $85.00 at Reece", line: "Dane" }],
      undo: true,
      undone: false,
    };
    const held = talkWithoutMoney(t);
    expect(held.said).toBe("$85 at Reece for fittings");
    expect(held.replies).toEqual([
      { who: "tiff", text: "How much was it: fittings at Reece? I have an amount." },
      { who: "you", text: "$85 inc" },
    ]);
    expect(held.made[0]!.name).toBe("Claim a cost at Reece");
  });
});
