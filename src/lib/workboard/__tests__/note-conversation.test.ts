/* THE ROUTER, TALKING — what the Tiff modal changed in note-brain, pure.

   Three things a note routed by the modal carries that the review card's
   never did: Tiff's own line (`say`), a question when a task has nobody on
   it, and a second read that sees the whole conversation. Each is pinned
   here without a network call, and so is the other half of each: the review
   card's notes are routed exactly as they were. */

import {
  NOTE_SCHEMA,
  SAY_MAX,
  isPlainAnswer,
  namesMentioned,
  noteContent,
  roomLine,
  sayBlock,
  shapeProposal,
  systemPrompt,
  whoBlock,
  type NoteContext,
  type NoteProposal,
} from "../note-brain";
import { recordStrings, foreignStrings, withTranslations } from "../note-english";
import { REPLY_IN_KIND } from "@/lib/lang/policy";

const ISAAC = { id: "s-me", fullName: "Isaac Smith" };
const STAFF = [
  ISAAC,
  { id: "s-luke", fullName: "Luke Nguyen" },
  { id: "s-callum", fullName: "Callum Reid" },
  { id: "s-jo", fullName: "Jo Baker" },
];
const ctx: NoteContext = { staff: STAFF, todayISO: "2026-09-25", author: ISAAC };
const modal: NoteContext = { ...ctx, askWho: true };

const raw = (over: Record<string, unknown> = {}) => ({
  tasks: [],
  bring_items: [],
  flags: [],
  progress_bullets: [],
  commissioning_entries: [],
  issue_entries: [],
  kb_entries: [],
  plain_note: "",
  say: "",
  clarify_needed: false,
  clarify_question: "",
  clarify_options: [],
  ...over,
});

const nobodysTask = raw({
  tasks: [{ title: "Order the grilles", detail: "", assignee_hint: "", due_hint: "", due_date: "", remind_time: "", remind_kind: "at" }],
  say: "A task to order the grilles.",
});

describe("say", () => {
  it("is a lane the model must fill", () => {
    expect(NOTE_SCHEMA.required).toContain("say");
    expect(NOTE_SCHEMA.properties.say).toEqual({ type: "string" });
  });

  it("is trimmed to 280 characters, and a missing one is empty", () => {
    const long = "x".repeat(400);
    expect(shapeProposal(raw({ say: `  ${long}  ` }), ctx).say).toHaveLength(SAY_MAX);
    expect(SAY_MAX).toBe(280);
    const { say: _dropped, ...none } = raw();
    void _dropped;
    expect(shapeProposal(none, ctx).say).toBe("");
    expect(shapeProposal(raw({ say: 42 }), ctx).say).toBe("");
  });

  it("is told to the model as the one field in the speaker's language, never done", () => {
    const block = sayBlock();
    expect(block).toMatch(/NOT a record/);
    expect(block).toMatch(/language the note\s+was spoken in/);
    expect(block).toMatch(/Never say anything is done/);
    const prompt = systemPrompt(ctx);
    expect(prompt).toContain(block);
    // the recording prompt carries its own carve-out, never the answering rule
    expect(prompt).not.toContain(REPLY_IN_KIND);
  });

  it("is left in the language it was spoken in by the English check", () => {
    const p: NoteProposal = {
      ...shapeProposal(raw({ plain_note: "Front desk has the key" }), ctx),
      say: "Anh Luke sẽ đặt hàng lưới tản nhiệt vào thứ Sáu.",
    };
    expect(recordStrings(p)).not.toContain(p.say);
    expect(foreignStrings(p)).toEqual([]);
    // even a translation keyed to its exact words does not reach it
    expect(withTranslations(p, new Map([[p.say, "Luke orders the grilles Friday."]])).say).toBe(p.say);
  });
});

describe("a task with nobody on it", () => {
  it("becomes a question on the modal's notes: Me, then the people the note names", () => {
    const p = shapeProposal(nobodysTask, modal, "Callum reckons the grilles need ordering, ask Luke or Jo");
    expect(p.tasks[0].assigneeId).toBeNull();
    expect(p.clarify).toEqual({
      question: "Who should do this: Order the grilles?",
      options: ["Me", "Callum", "Luke"],
    });
    // Tiff's line ends with the question she did not write herself
    expect(p.say).toBe("A task to order the grilles. Who should do this: Order the grilles?");
  });

  it("stays a task for the review card's dropdown on the card's notes", () => {
    const p = shapeProposal(nobodysTask, ctx, "Callum reckons the grilles need ordering");
    expect(p.clarify).toBeNull();
    expect(p.say).toBe("A task to order the grilles.");
    expect(whoBlock(ctx)).not.toMatch(/cannot\s+wait for a dropdown/);
    expect(whoBlock(modal)).toMatch(/cannot\s+wait for a dropdown/);
  });

  it("offers no Me when nobody is speaking", () => {
    const p = shapeProposal(nobodysTask, { ...modal, author: undefined }, "tell Jo");
    expect(p.clarify?.options).toEqual(["Jo"]);
  });

  it("gives way to the model's own question", () => {
    const p = shapeProposal(
      { ...nobodysTask, clarify_needed: true, clarify_question: "Which grilles?", clarify_options: ["Supply", "Return"], say: "Which grilles?" },
      modal,
    );
    expect(p.clarify?.question).toBe("Which grilles?");
    expect(p.say).toBe("Which grilles?");
  });

  it("keeps the question whole when Tiff's line is long", () => {
    const p = shapeProposal({ ...nobodysTask, say: "y".repeat(280) }, modal);
    expect(p.say.length).toBeLessThanOrEqual(SAY_MAX);
    expect(p.say.endsWith("Who should do this: Order the grilles?")).toBe(true);
  });
});

describe("namesMentioned", () => {
  it("offers only people on the roster, in the order said, never the speaker, at most two", () => {
    expect(namesMentioned("Dave and Jo, then Luke, then Callum; me too Isaac", STAFF, "s-me")).toEqual([
      "Jo",
      "Luke",
    ]);
  });

  it("offers a shared first name whole, so picking it can't ask again", () => {
    const twoLukes = [...STAFF, { id: "s-luke-t", fullName: "Luke Tran" }];
    expect(namesMentioned("tell luke", twoLukes, "s-me")).toEqual(["Luke Nguyen", "Luke Tran"]);
  });

  it("matches whole words only", () => {
    expect(namesMentioned("the jolly roger", STAFF)).toEqual([]);
  });
});

describe("the room", () => {
  it("says what a bare instruction most likely is where it was typed, and nothing on Home", () => {
    expect(roomLine("tasks")).toMatch(/task for the person speaking/);
    expect(roomLine("diary")).toMatch(/plain_note/);
    expect(roomLine("calendar")).toMatch(/due_date and remind_time/);
    expect(roomLine("home")).toBe("");
    expect(roomLine(undefined)).toBe("");
    expect(systemPrompt({ ...ctx, room: "tasks" })).toContain(roomLine("tasks"));
    expect(systemPrompt({ ...ctx, room: "home" })).toBe(systemPrompt(ctx));
  });
});

describe("the second read", () => {
  const plan: NoteProposal = {
    ...shapeProposal(raw(), ctx),
    tasks: [
      {
        title: "Order the grilles",
        detail: "",
        assigneeId: null,
        assigneeHint: "",
        dueHint: "",
        dueDate: "",
        remindTime: "",
        remindKind: "at",
      },
      {
        title: "Ring the sparky",
        detail: "",
        assigneeId: "s-luke",
        assigneeHint: "Luke",
        dueHint: "Friday",
        dueDate: "2026-09-26",
        remindTime: "07:00",
        remindKind: "at",
      },
    ],
    flags: [{ message: "Roof hatch seized", severity: "warn" }],
    say: "Who should do this: Order the grilles?",
    clarify: { question: "Who should do this: Order the grilles?", options: ["Me", "Callum"] },
  };
  const turns = (reply: string) => [
    { who: "you" as const, text: "grilles need ordering, Luke ring the sparky Friday", at: "" },
    { who: "tiff" as const, text: "Who should do this: Order the grilles?", at: "" },
    { who: "you" as const, text: reply, at: "" },
  ];

  it("is only the note on a first read", () => {
    expect(noteContent("  the note  ")).toBe("Note:\nthe note");
  });

  it("sends the plan, the conversation since and the rows taken off", () => {
    const content = noteContent("grilles need ordering", { plan, turns: turns("Callum"), leftOut: ["flags:0", "nope:1"] }, STAFF);
    expect(content).toContain("Your plan so far:");
    expect(content).toContain("- Task for nobody yet: Order the grilles");
    expect(content).toContain("- Task for Luke Nguyen: Ring the sparky, due 2026-09-26 at 07:00");
    expect(content).toContain("- Your question: Who should do this: Order the grilles?");
    expect(content).toContain("The conversation since:\nYou: Who should do this: Order the grilles?\nThey: Callum");
    // the note's own turn is the note, not part of "since"
    expect(content).not.toContain("They: grilles need ordering");
    expect(content).toContain("They took these off the plan, so leave them off:\n- Flag (warn): Roof hatch seized");
    expect(content).toContain("Route the whole note again with what they said.");
  });

  it("says Do not ask again only on a plain answer", () => {
    const plain = noteContent("n", { plan, turns: turns("callum "), leftOut: [] });
    expect(plain).toContain("Do not ask again.");
    const free = noteContent("n", { plan, turns: turns("no, Luke's doing both, drop the flag"), leftOut: [] });
    expect(free).not.toContain("Do not ask again");
    expect(free).toContain("Ask again only if something is still unclear.");
    // the card's box forces it, as it always did
    expect(noteContent("n", { plan, turns: turns("the tall one"), leftOut: [], plain: true })).toContain(
      "Do not ask again.",
    );
    expect(isPlainAnswer(plan, "ME")).toBe(true);
    expect(isPlainAnswer({ ...plan, clarify: null }, "Me")).toBe(false);
  });
});
