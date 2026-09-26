/* The plan as rows, and a stored proposal read back.

   `fileNote` files from these on the server, so the two things that matter
   are which row a cross in the modal names — by its place in the stored
   proposal, never by its words — and that a proposal stored by an older
   version of the router still files rather than throwing. The draft rules
   themselves (`toDraft`, `toConfirmed`, `blockers`) moved here from the
   review card unchanged, and their tests followed them when the card went
   (2026-09-27): "the draft rules", at the foot. */

import { blockers, planRows, storedProposal, toConfirmed, toDraft, withoutRows, type Draft } from "../note-draft";
import type { NoteProposal } from "../note-brain";

const P: NoteProposal = {
  tasks: [
    {
      title: "Order the grilles",
      detail: "",
      assigneeId: "s-luke",
      assigneeHint: "Luke",
      dueHint: "",
      dueDate: "",
      remindTime: "",
      remindKind: "at",
    },
    {
      title: "Order the grilles",
      detail: "the other lot",
      assigneeId: "s-jo",
      assigneeHint: "Jo",
      dueHint: "",
      dueDate: "",
      remindTime: "",
      remindKind: "at",
    },
  ],
  bringItems: ["coil cleaner"],
  flags: [{ message: "Roof hatch seized", severity: "urgent" }],
  progressBullets: ["Belts swapped"],
  commissioningEntries: [{ body: "Superheat 6K", equipmentHint: "" }],
  issueEntries: [{ body: "Tripped again", equipmentHint: "RTU-2" }],
  kbEntries: [{ title: "Clearing an E6", body: "Power the outdoor board separately." }],
  plainNote: "",
  say: "",
  clarify: null,
};

describe("planRows", () => {
  it("names every row by its lane and place, in the order the plan reads", () => {
    expect(planRows(P).map((r) => [r.key, r.text])).toEqual([
      ["tasks:0", "Order the grilles"],
      ["tasks:1", "Order the grilles"],
      ["flags:0", "Roof hatch seized"],
      ["issueEntries:0", "Tripped again"],
      ["bringItems:0", "coil cleaner"],
      ["progressBullets:0", "Belts swapped"],
      ["commissioningEntries:0", "Superheat 6K"],
      ["kbEntries:0", "Clearing an E6"],
    ]);
  });
});

describe("withoutRows", () => {
  it("takes off exactly the rows named, even when two say the same words", () => {
    const c = toConfirmed(withoutRows(toDraft(P), ["tasks:1", "flags:0"]));
    expect(c.tasks.map((t) => t.assigneeId)).toEqual(["s-luke"]);
    expect(c.flags).toEqual([]);
    expect(c.bringItems).toEqual(["coil cleaner"]);
  });

  it("ignores a key that names nothing, and can never put a row back", () => {
    const d = toDraft(P);
    d.bringItems[0].on = false;
    const c = toConfirmed(withoutRows(d, ["tasks:7", "nope:0", "tasks", "tasks:-1", 5 as unknown as string]));
    expect(c.tasks).toHaveLength(2);
    expect(c.bringItems).toEqual([]);
  });

  it("leaves the draft it was given alone", () => {
    const d = toDraft(P);
    withoutRows(d, ["tasks:0"]);
    expect(d.tasks[0].on).toBe(true);
  });
});

describe("storedProposal", () => {
  it("reads a proposal stored before say, the library lane and reminders existed", () => {
    const old = {
      tasks: [{ title: "Order the grilles", detail: "", assigneeId: "s-luke", assigneeHint: "Luke", dueHint: "" }],
      bringItems: ["coil cleaner", 7, ""],
      flags: [{ message: "Roof hatch", severity: "catastrophic" }, { severity: "warn" }],
      progressBullets: [],
      commissioningEntries: [],
      issueEntries: [{ body: "Tripped again", equipmentHint: "" }],
      plainNote: "noted",
      clarify: null,
      debrief: true,
    };
    const p = storedProposal(old)!;
    expect(p.tasks[0]).toEqual({
      title: "Order the grilles",
      detail: "",
      assigneeId: "s-luke",
      assigneeHint: "Luke",
      dueHint: "",
      dueDate: "",
      remindTime: "",
      remindKind: "at",
    });
    expect(p.bringItems).toEqual(["coil cleaner"]);
    expect(p.flags).toEqual([{ message: "Roof hatch", severity: "warn" }]);
    expect(p.kbEntries).toEqual([]);
    expect(p.say).toBe("");
    expect(p).not.toHaveProperty("debrief");
    // and it drafts: nothing downstream meets a missing lane
    expect(toConfirmed(toDraft(p)).tasks).toHaveLength(1);
  });

  it("is null for anything that is not a proposal", () => {
    expect(storedProposal(null)).toBeNull();
    expect(storedProposal("tasks")).toBeNull();
    expect(storedProposal([])).toBeNull();
  });

  it("keeps a question only when it has one", () => {
    expect(storedProposal({ clarify: { question: "Which Luke?", options: ["A", 1] } })!.clarify).toEqual({
      question: "Which Luke?",
      options: ["A"],
    });
    expect(storedProposal({ clarify: { question: "  " } })!.clarify).toBeNull();
  });

  it("reads back what it was given, unchanged, for a proposal of today's shape", () => {
    expect(storedProposal(JSON.parse(JSON.stringify(P)))).toEqual(P);
  });
});

/* ── THE DRAFT RULES ─────────────────────────────────────────────────────

   THE CARD THAT REFUSED TO SAVE A REMINDER. Isaac dictated "…remind me to do
   that on Monday morning" and the review card showed a well-titled task, the
   right Monday, an empty "Assign to…" and an amber bar reading "One task
   still needs a person on it". Underneath, the cascade said "No tasks for
   anyone" while the task sat on screen a centimetre above — because
   `toConfirmed` drops a task with no assignee, and everything downstream
   counts what survives that.

   The router's half of the fix is pinned in note-brain's suite. These are
   the draft's half: that a task with a person on it stops blocking, that a
   time of day survives the round trip out to the server, and that a time
   never travels without the day it belongs to. They were the review card's
   tests; the card went with the old capture UI (2026-09-27), and `fileNote`
   files through the same `toDraft` and `toConfirmed`. */
describe("the draft rules", () => {
  const EMPTY: NoteProposal = {
    tasks: [],
    bringItems: [],
    flags: [],
    progressBullets: [],
    commissioningEntries: [],
    issueEntries: [],
    kbEntries: [],
    plainNote: "",
    say: "",
    clarify: null,
  };

  const reminder = (task: Partial<NoteProposal["tasks"][number]> = {}): NoteProposal => ({
    ...EMPTY,
    tasks: [
      {
        title: "Check with Luke about quote to Chris from Scott Group",
        detail: "Did the quote go out?",
        assigneeId: "s-isaac",
        assigneeHint: "me",
        dueHint: "Monday morning",
        dueDate: "2026-08-24",
        remindTime: "06:30",
        remindKind: "at" as const,
        ...task,
      },
    ],
  });

  it("stops blocking once the task has a person on it", () => {
    expect(blockers(toDraft(reminder()), false)).toEqual([]);
  });

  it("still blocks when nobody could be resolved — that rule is unchanged", () => {
    /* The bar was RIGHT; what was wrong was that "me" could never satisfy it.
       Assigning real work to nobody is still the failure this refuses. */
    expect(blockers(toDraft(reminder({ assigneeId: null })), false)).toEqual([
      "One task still needs a person on it — assign it, or untick it.",
    ]);
  });

  it("keeps a task with a person on it, and drops one with nobody", () => {
    expect(toConfirmed(toDraft(reminder())).tasks).toHaveLength(1);
    expect(toConfirmed(toDraft(reminder({ assigneeId: null }))).tasks).toHaveLength(0);
  });

  /* Proof that `blockers` reads the TICKED rows, not every row, so unticking
     an unassignable task clears the bar exactly as the message says it will. */
  it("lets you untick the task instead of assigning it", () => {
    const d: Draft = toDraft(reminder({ assigneeId: null }));
    expect(blockers(d, false)).toHaveLength(1);
    d.tasks[0].on = false;
    expect(blockers(d, false)).toEqual([]);
  });

  it("keeps the day and the time the note asked for", () => {
    expect(toConfirmed(toDraft(reminder())).tasks[0]).toMatchObject({
      dueDate: "2026-08-24",
      remindTime: "06:30",
    });
  });

  it("sends no time for an ordinary task", () => {
    expect(toConfirmed(toDraft(reminder({ remindTime: "" }))).tasks[0].remindTime).toBeNull();
  });

  it("never sends a time without the day it belongs to", () => {
    /* A time with no date is not a moment. `remindAtFrom` would refuse it
       server-side anyway, so sending it would put a value in the payload that
       cannot become anything — and would look, in the database, like a
       reminder that simply never fired. */
    const d = toDraft(reminder({ dueDate: "" }));
    expect(d.tasks[0].remindTime).toBe("06:30"); // the draft still remembers it
    expect(toConfirmed(d).tasks[0].remindTime).toBeNull(); // the wire does not
  });

  /* THE DEBRIEF'S LEFTOVERS ARE OFF THE WIRE. The router has no note-lines
     lane any more and nothing files one, so a proposal that still carries it
     — a router answer from an old build — sends no lines that the server
     would count as nothing. */
  it("sends no noteLines", () => {
    const stale = { ...EMPTY, noteLines: ["chase the coil pricing"] } as NoteProposal;
    expect(toConfirmed(toDraft(stale))).not.toHaveProperty("noteLines");
  });
});
