/* The plan as rows, and a stored proposal read back.

   `fileNote` files from these on the server, so the two things that matter
   are which row a cross in the modal names — by its place in the stored
   proposal, never by its words — and that a proposal stored by an older
   version of the router still files rather than throwing. The draft rules
   themselves (`toDraft`, `toConfirmed`, `blockers`) moved here from the
   review card unchanged and are pinned in its suite. */

import { planRows, storedProposal, toConfirmed, toDraft, withoutRows } from "../note-draft";
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
