/* The names people go by, in the router (Isaac, 2026-09-29): "Tell Bobo he
   needs to drop his van off tomorrow morning", where Bobo is Leonardo
   Martins. The first time, Tiff asks "Who's Bobo?"; once she's been told,
   Bobo is Leonardo for everyone. */

import {
  namesMentioned,
  peopleNamed,
  resolveAssignee,
  shapeProposal,
  whoBlock,
  type NoteContext,
  type NoteStaff,
} from "../note-brain";

const ISAAC: NoteStaff = { id: "s-me", fullName: "Isaac Smith" };
const LEO: NoteStaff = { id: "s-leo", fullName: "Leonardo Martins" };
const BOBBY: NoteStaff = { id: "s-bobby", fullName: "Bobby Tran" };
const STAFF = [ISAAC, LEO, BOBBY];
const KNOWN = [ISAAC, { ...LEO, aliases: ["Bobo", "Big Leo"] }, BOBBY];

const task = (hint: string) => ({
  tasks: [{ title: "Drop the van off", detail: "", assignee_hint: hint, due_hint: "tomorrow morning", due_date: "2026-09-30", remind_time: "", remind_kind: "at" }],
  bring_items: [],
  flags: [],
  progress_bullets: [],
  commissioning: [],
  recurring_issue: null,
  plain_note: "",
  clarify_needed: false,
  clarify_question: "",
  clarify_options: [],
  say: "",
});
const modal = (staff: NoteStaff[]): NoteContext => ({ staff, todayISO: "2026-09-29", author: ISAAC, askWho: true, speak: true });

describe("resolveAssignee and the names people go by", () => {
  it("(F) finds Leonardo by a nickname, in any case", () => {
    expect(resolveAssignee("Bobo", KNOWN, ISAAC.id)).toEqual({ kind: "one", id: "s-leo" });
    expect(resolveAssignee("big  LEO", KNOWN, ISAAC.id)).toEqual({ kind: "one", id: "s-leo" });
  });

  it("(F) knows nobody by a nickname nobody has taught it", () => {
    expect(resolveAssignee("Bobo", STAFF, ISAAC.id)).toEqual({ kind: "none" });
  });

  it("(F) reads a real name before any nickname", () => {
    const clash = [...KNOWN, { id: "s-bobo", fullName: "Bobo Diallo" }];
    expect(resolveAssignee("Bobo", clash, ISAAC.id)).toEqual({ kind: "one", id: "s-bobo" });
  });

  it("asks rather than picks when two people go by the same name", () => {
    const two = [...KNOWN, { id: "s-x", fullName: "Xavier Ong", aliases: ["bobo"] }];
    expect(resolveAssignee("Bobo", two, ISAAC.id)).toEqual({ kind: "ambiguous", names: ["Leonardo Martins", "Xavier Ong"] });
  });
});

describe("the question and the answer", () => {
  it("(F) asks who a name is BY NAME the first time", () => {
    const p = shapeProposal(task("Bobo"), modal(STAFF), "Tell Bobo he needs to drop his van off tomorrow morning");
    expect(p.clarify?.question).toBe("Who's Bobo?");
    expect(p.clarify?.options).toEqual(["Me"]);
    expect(p.tasks[0]).toMatchObject({ assigneeId: null, assigneeHint: "Bobo" });
  });

  it("(F) files it straight to Leonardo once Bobo is known", () => {
    const p = shapeProposal(task("Bobo"), modal(KNOWN), "Tell Bobo he needs to drop his van off tomorrow morning");
    expect(p.clarify).toBeNull();
    expect(p.tasks[0].assigneeId).toBe("s-leo");
  });

  it("keeps the old question for a task with nobody named, and for a role", () => {
    expect(shapeProposal(task(""), modal(STAFF)).clarify?.question).toBe("Who should do this: Drop the van off?");
    expect(shapeProposal(task("the sparky"), modal(STAFF)).clarify?.question).toBe("Who should do this: Drop the van off?");
  });

  it("(F) offers a known nickname's person when the note names them by it", () => {
    expect(namesMentioned("tell bobo and bobby", KNOWN, ISAAC.id)).toEqual(["Leonardo", "Bobby"]);
  });

  it("(F) reads who an answer names, by id, the speaker left out", () => {
    expect(peopleNamed("Leonardo", STAFF, ISAAC.id)).toEqual(["s-leo"]);
    expect(peopleNamed("it's Leonardo Martins", STAFF, ISAAC.id)).toEqual(["s-leo"]);
    expect(peopleNamed("Me", STAFF, ISAAC.id)).toEqual([]);
    expect(peopleNamed("Isaac", STAFF, ISAAC.id)).toEqual([]);
    expect(peopleNamed("Leonardo or Bobby", STAFF, ISAAC.id)).toEqual(["s-leo", "s-bobby"]);
    // a name of two words is found as those words in a row
    expect(peopleNamed("big leo", KNOWN, ISAAC.id)).toEqual(["s-leo"]);
    expect(peopleNamed("leo is big", KNOWN, ISAAC.id)).toEqual([]);
  });

  it("tells the model the names people go by", () => {
    expect(whoBlock(modal(KNOWN))).toContain("Leonardo Martins (also called Bobo, Big Leo)");
    expect(whoBlock(modal(STAFF))).toContain("People who can be assigned work: Isaac Smith, Leonardo Martins, Bobby Tran.");
  });
});
