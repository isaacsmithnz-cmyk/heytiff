/* THE DIARY'S ENTRIES, SAID — who and when over the words, and what they
   became under them. The entries are the ones his prototype drew from
   Isaac's real diary (the German and Portuguese asks of 28 Aug, the van's
   wipers of 22 Aug, "mark Isaac Smith as sick" of 8 Sept). */

import {
  NOTHING_FILED,
  entryUnder,
  entryWhen,
  ownerNames,
  taskOwners,
  type DiaryDoor,
} from "../diary-doors";
import { diaryFeed, type DiaryConversation } from "../diary-feed";
import type { DiaryEntry, Outcome } from "../journal";

const ME = "s-isaac";
// yours is named too, so a door that said "for Isaac" to Isaac would show
const names = { [ME]: "Isaac", "s-luke": "Luke", "s-lorenzo": "Lorenzo", "s-leo": "Leo" };
const who = { viewerStaffId: ME, names };

const task = (id: string, text = "a task"): Outcome => ({ kind: "todo", text, go: { type: "task", id } });

const entry = (over: Partial<DiaryEntry> = {}): DiaryEntry => ({
  id: "e1",
  said: "Pode falar pro Lorenzo pegar filtros na Atchoum e levar para o Davey Boy.",
  day: "2026-08-28",
  at: "6:43 am",
  outcomes: [],
  spoken: true,
  stamp: "2026-08-28 06:43:00",
  routed: true,
  taskFor: {},
  turns: [],
  undo: false,
  undone: false,
  ...over,
});

describe("entryUnder: the doors", () => {
  it("says tasks by whose they are, one door each, carrying every task it counts", () => {
    const { doors } = entryUnder(
      entry({
        outcomes: [task("t1"), task("t2"), task("t3"), task("t4")],
        taskFor: { t1: "s-lorenzo", t2: "s-luke", t3: "s-luke", t4: ME },
      }),
      who,
    );
    expect(doors).toEqual<DiaryDoor[]>([
      { to: "tasks", text: "1 task for Lorenzo", ids: ["t1"] },
      { to: "tasks", text: "2 tasks for Luke", ids: ["t2", "t3"] },
      { to: "tasks", text: "1 task", ids: ["t4"] },
    ]);
  });

  it("names nobody for your own task, or one on nobody, and counts them together", () => {
    const { doors } = entryUnder(
      entry({ outcomes: [task("t1"), task("t2")], taskFor: { t1: ME, t2: null } }),
      who,
    );
    expect(doors).toEqual([{ to: "tasks", text: "2 tasks", ids: ["t1", "t2"] }]);
  });

  /* By the card, never by the name on it: two Lukes are two people, and
     one door for both would light the other Luke's rows too — whatever
     they are called (`ownerNames` gives them their whole names). */
  it("gives two people a door each, even when they are called the same", () => {
    const { doors } = entryUnder(
      entry({
        outcomes: [task("t1"), task("t2"), task("t3")],
        taskFor: { t1: "s-luke", t2: "s-luke-2", t3: "s-luke" },
      }),
      { viewerStaffId: ME, names: { "s-luke": "Luke", "s-luke-2": "Luke" } },
    );
    expect(doors).toEqual<DiaryDoor[]>([
      { to: "tasks", text: "2 tasks for Luke", ids: ["t1", "t3"] },
      { to: "tasks", text: "1 task for Luke", ids: ["t2"] },
    ]);
  });

  /* A card the workspace no longer names is still somebody else's: "1
     task" counted in with yours would say it was yours. */
  it("never counts a task on a card it cannot name in with your own", () => {
    const { doors } = entryUnder(
      entry({ outcomes: [task("t1"), task("t2"), task("t3")], taskFor: { t1: ME, t2: "s-gone", t3: null } }),
      who,
    );
    expect(doors).toEqual<DiaryDoor[]>([
      { to: "tasks", text: "2 tasks", ids: ["t1", "t3"] },
      { to: "tasks", text: "1 task", ids: ["t2"] },
    ]);
  });

  it("counts the task titles rather than repeating them: the words are already above", () => {
    const { doors } = entryUnder(
      entry({ outcomes: [task("t1", "Filters from Atchoum")], taskFor: { t1: "s-lorenzo" } }),
      who,
    );
    expect(doors.map((d) => d.text)).toEqual(["1 task for Lorenzo"]);
  });

  it("keeps the Library's, a kept note's and an issue's doors, in the words the journal gave them", () => {
    const { doors, lines } = entryUnder(
      entry({
        outcomes: [
          { kind: "todo", text: "Rooftop unit keeps tripping", go: { type: "issue", id: "i1" } },
          { kind: "kept", text: "Isolator sizes for a 7.1 kW", go: { type: "kb", id: "k1" } },
          { kind: "kept", text: "1 line kept", go: { type: "note", id: "n1" } },
        ],
      }),
      who,
    );
    expect(doors).toEqual<DiaryDoor[]>([
      { to: "issue", text: "Rooftop unit keeps tripping", id: "i1" },
      { to: "kb", text: "Isolator sizes for a 7.1 kW", id: "k1" },
      { to: "note", text: "1 line kept", id: "n1" },
    ]);
    expect(lines).toEqual([]);
  });
});

describe("entryUnder: the quiet lines", () => {
  it("says what has nowhere to go as a sentence: a removed task, a kept line with no note, a flag", () => {
    const { doors, lines } = entryUnder(
      entry({
        outcomes: [
          task("t1"),
          { kind: "todo", text: "1 task removed" },
          { kind: "todo", text: "2 flags" },
          { kind: "kept", text: "1 line kept" },
        ],
        taskFor: { t1: ME },
      }),
      who,
    );
    expect(doors).toEqual([{ to: "tasks", text: "1 task", ids: ["t1"] }]);
    expect(lines).toEqual(["1 task removed.", "2 flags.", "1 line kept."]);
  });

  it("says \"Nothing filed.\" when Tiff read the words and made nothing", () => {
    expect(entryUnder(entry({ said: "Can you mark Isaac Smith as sick? Today.", routed: true }), who)).toEqual({
      doors: [],
      lines: [NOTHING_FILED],
    });
    expect(NOTHING_FILED).toBe("Nothing filed.");
  });

  it("says nothing under a Save, which filed the words as typed and asked Tiff nothing", () => {
    expect(entryUnder(entry({ routed: false }), who)).toEqual({ doors: [], lines: [] });
  });

  it("never says \"Nothing filed.\" under an entry that filed something", () => {
    const { lines } = entryUnder(entry({ outcomes: [task("t1")], taskFor: { t1: ME } }), who);
    expect(lines).toEqual([]);
  });

  it("says nothing under an entry Undo took back: what it made has gone, and Tiff's line says so", () => {
    // routed, and its outcomes still in hand where Undo was pressed on the page
    const back = entry({ routed: true, outcomes: [task("t1")], taskFor: { t1: "s-luke" }, undone: true });
    expect(entryUnder(back, who)).toEqual({ doors: [], lines: [] });
    expect(entryUnder({ ...back, outcomes: [] }, who)).toEqual({ doors: [], lines: [] });
  });
});

describe("entryUnder: a door with nowhere to land", () => {
  const made = entry({
    outcomes: [
      task("t1"),
      task("t2"),
      task("t3"),
      { kind: "todo", text: "Rooftop unit keeps tripping", go: { type: "issue", id: "i1" } },
      { kind: "todo", text: "Condensate pump is noisy.", go: { type: "issue", id: "i2" } },
      { kind: "kept", text: "Isolator sizes for a 7.1 kW", go: { type: "kb", id: "k1" } },
      { kind: "kept", text: "1 line kept", go: { type: "note", id: "n1" } },
    ],
    taskFor: { t1: "s-luke", t2: "s-luke", t3: ME },
  });

  /* The Tasks tab keeps what was done lately and the open issues, the
     list what is open: a task ticked off long ago and a resolved issue are
     on neither. A door would open on some other row. */
  it("says a task or an issue no row on the page holds, rather than drawing its door", () => {
    const { doors, lines } = entryUnder(made, who, new Set(["t3", "i1"]));
    expect(doors).toEqual<DiaryDoor[]>([
      { to: "tasks", text: "1 task", ids: ["t3"] },
      { to: "issue", text: "Rooftop unit keeps tripping", id: "i1" },
      { to: "kb", text: "Isolator sizes for a 7.1 kW", id: "k1" },
      { to: "note", text: "1 line kept", id: "n1" },
    ]);
    // one full stop, whether or not the words brought their own
    expect(lines).toEqual(["2 tasks for Luke.", "Condensate pump is noisy."]);
  });

  it("keeps a task door that can show any of its tasks, carrying them all", () => {
    const { doors } = entryUnder(made, who, new Set(["t2"]));
    expect(doors[0]).toEqual({ to: "tasks", text: "2 tasks for Luke", ids: ["t1", "t2"] });
  });

  it("draws every door when it is not told what the page holds", () => {
    expect(entryUnder(made, who).doors).toHaveLength(6);
  });
});

describe("ownerNames", () => {
  const feedOf = (taskFor: Record<string, string | null>) =>
    diaryFeed({
      entries: [entry({ taskFor })],
      conversations: [] as DiaryConversation[],
      day: "2026-09-25",
      mentions: false,
      entriesCut: false,
      syncedAt: null,
    });
  const staff = new Map([
    [ME, "Isaac Smith"],
    ["s-luke", "Luke Ingold"],
    ["s-luke-2", "Luke  Moreau"],
    ["s-lorenzo", "Lorenzo Russo"],
    ["s-leo", "Leo Park"],
  ]);

  it("names the people the diary's tasks are on by first name, and nobody else", () => {
    expect(ownerNames(feedOf({ t1: "s-lorenzo", t2: ME, t3: null }), staff)).toEqual({
      "s-lorenzo": "Lorenzo",
      [ME]: "Isaac",
    });
  });

  it("gives each the whole name when two of them share the first", () => {
    expect(ownerNames(feedOf({ t1: "s-luke", t2: "s-luke-2", t3: "s-lorenzo" }), staff)).toEqual({
      "s-luke": "Luke Ingold",
      "s-luke-2": "Luke Moreau",
      "s-lorenzo": "Lorenzo",
    });
  });

  it("leaves out a card it has no name for", () => {
    expect(ownerNames(feedOf({ t1: "s-gone" }), staff)).toEqual({});
  });
});

describe("entryWhen", () => {
  it("says the time alone today, the day and the time before today, and \"just now\" for what you filed here", () => {
    const e = entry({ day: "2026-09-08", at: "8:42 pm" });
    expect(entryWhen(e, { today: true, justNow: false })).toBe("8:42 pm");
    expect(entryWhen(e, { today: false, justNow: false })).toBe("Tue 8 Sept, 8:42 pm");
    expect(entryWhen(e, { today: true, justNow: true })).toBe("just now");
  });
});

describe("taskOwners", () => {
  it("is everyone this diary's tasks are on, once each, and nobody for a task on no one", () => {
    const feed = diaryFeed({
      entries: [
        entry({ id: "a", stamp: "2026-09-25 09:00:00", day: "2026-09-25", taskFor: { t1: "s-luke", t2: null } }),
        entry({ id: "b", stamp: "2026-08-28 06:43:00", taskFor: { t3: "s-lorenzo", t4: "s-luke" } }),
      ],
      conversations: [] as DiaryConversation[],
      day: "2026-09-25",
      mentions: false,
      entriesCut: false,
      syncedAt: null,
    });
    expect(taskOwners(feed).sort()).toEqual(["s-lorenzo", "s-luke"]);
  });
});
