/* THE ROUTER, TALKING — what the Tiff modal changed in note-brain, pure.

   Three things a note routed by the modal carries that the review card's
   never did: Tiff's own line (`say`), a question when a task has nobody on
   it, and a second read that sees the whole conversation. Each is pinned
   here without a network call, and so is the other half of each: a read
   that does not turn them on is routed as the card's notes were (the card
   went with the old capture UI, 2026-09-27). */

import {
  NOTE_SCHEMA,
  SAY_MAX,
  TIFF_NOTE_SCHEMA,
  earlierBlock,
  isPlainAnswer,
  namesMentioned,
  noteContent,
  roomLine,
  sayBlock,
  shapeProposal,
  systemPrompt,
  whenBlock,
  whoBlock,
  type NoteContext,
  type NoteProposal,
} from "../note-brain";
import { recordStrings, foreignStrings, withTranslations } from "../note-english";
import { RECORD_LANGUAGE, REPLY_IN_KIND } from "@/lib/lang/policy";
import { EARLIER_TEXT_MAX, EARLIER_TURNS, earlierTurns } from "../note-turns";

const ISAAC = { id: "s-me", fullName: "Isaac Smith" };
const STAFF = [
  ISAAC,
  { id: "s-luke", fullName: "Luke Nguyen" },
  { id: "s-callum", fullName: "Callum Reid" },
  { id: "s-jo", fullName: "Jo Baker" },
];
const ctx: NoteContext = { staff: STAFF, todayISO: "2026-09-25", author: ISAAC };
const modal: NoteContext = { ...ctx, askWho: true, speak: true };

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
  it("is a lane the model must fill on the modal's notes, and no lane at all on the card's", () => {
    expect(TIFF_NOTE_SCHEMA.required).toContain("say");
    expect(TIFF_NOTE_SCHEMA.properties.say).toEqual({ type: "string" });
    expect(NOTE_SCHEMA.required).not.toContain("say");
    expect(NOTE_SCHEMA.properties).not.toHaveProperty("say");
  });

  it("is the only thing the modal's schema adds to the card's, ahead of the question", () => {
    const { say, ...rest } = TIFF_NOTE_SCHEMA.properties;
    void say;
    expect(rest).toEqual(NOTE_SCHEMA.properties);
    expect(TIFF_NOTE_SCHEMA.required).toEqual(Object.keys(TIFF_NOTE_SCHEMA.properties));
    expect(Object.keys(TIFF_NOTE_SCHEMA.properties).slice(-4)).toEqual([
      "say",
      "clarify_needed",
      "clarify_question",
      "clarify_options",
    ]);
    expect(TIFF_NOTE_SCHEMA.additionalProperties).toBe(false);
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
    const prompt = systemPrompt(modal);
    expect(prompt).toContain(block);
    // the recording prompt carries its own carve-out, never the answering rule
    expect(prompt).not.toContain(REPLY_IN_KIND);
  });

  it("keeps the question and its answers a record: only `say` follows the speaker", () => {
    /* A German note's clarify_question came back in German when this block
       said only that `say` follows the speaker (2026-09-26). */
    const block = sayBlock();
    expect(block).toContain(
      `clarify_question and clarify_options are records like every other field:\nwrite them in ${RECORD_LANGUAGE}, whatever language the note was spoken\nin. Only \`say\` follows the language they spoke.`,
    );
    // and the question Tiff says is said in theirs
    expect(block).toMatch(/end it\s+with the question, asked in their language/);
  });

  it("is never asked of the review card's notes: its prompt says nothing about `say`", () => {
    const card: NoteContext = { ...ctx, targetLabel: "#1042 — Smith St" };
    const prompt = systemPrompt(card);
    expect(prompt).not.toContain(sayBlock());
    expect(prompt).not.toMatch(/`say`/);
    /* The card's prompt as it was before the modal, line for line: the
       question rule runs straight into the dates, and the dates straight
       into the job, with no line left behind by what the modal adds. */
    expect(prompt).toContain(`you are confident about; do not blank the rest.\n\n${whenBlock(card)}\n\nThis note is about:`);
    expect(systemPrompt(modal)).toContain(`do not blank the rest.\n\n${sayBlock()}\n\n${whenBlock(modal)}`);
  });

  it("is empty on the card's notes even when the shaper asks the question", () => {
    const twoLukes = [...STAFF, { id: "s-luke-t", fullName: "Luke Tran" }];
    const { say: _none, ...cardRaw } = raw({
      tasks: [{ title: "Order the grilles", detail: "", assignee_hint: "Luke", due_hint: "", due_date: "", remind_time: "", remind_kind: "at" }],
    });
    void _none;
    const card = shapeProposal(cardRaw, { ...ctx, staff: twoLukes });
    expect(card.clarify?.question).toBe("Which Luke did you mean?");
    expect(card.say).toBe("");
    // the modal's line carries the question it did not write itself
    expect(shapeProposal(cardRaw, { ...modal, staff: twoLukes }).say).toBe("Which Luke did you mean?");
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
    // her line was written for a plan the app just stopped: the question is all she says
    expect(p.say).toBe("Who should do this: Order the grilles?");
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

  it("sets aside a line in another language rather than tack English onto it", () => {
    const p = shapeProposal(
      raw({
        tasks: [{ title: "Order the grilles", detail: "", assignee_hint: "Leo", due_hint: "", due_date: "", remind_time: "", remind_kind: "at" }],
        say: "Ich lege eine Aufgabe für Leo an.".padEnd(SAY_MAX, "."),
      }),
      modal,
    );
    expect(p.say).toBe("Who should do this: Order the grilles?");
    expect(p.say.length).toBeLessThanOrEqual(SAY_MAX);
  });

  it("asks the model to raise a name nobody answers to itself, on the modal's notes only", () => {
    expect(whoBlock(modal)).toMatch(/none of the people above, set\s+clarify_needed/);
    expect(whoBlock(ctx)).not.toMatch(/none of the people above/);
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
    expect(isPlainAnswer(plan, "ME")).toBe(true);
    expect(isPlainAnswer({ ...plan, clarify: null }, "Me")).toBe(false);
  });
});

describe("the conversation before a new note", () => {
  const earlier = [
    { who: "you" as const, text: "Luke has the Bellevue Hill head on the ute" },
    { who: "tiff" as const, text: "Done. Luke puts the Bellevue Hill head on the ute." },
  ];

  it("is told to the router as context to read the note by, never as more to file", () => {
    const prompt = systemPrompt({ ...modal, earlier });
    expect(prompt).toContain(earlierBlock(earlier));
    expect(prompt).toContain(
      "They: Luke has the Bellevue Hill head on the ute\nYou: Done. Luke puts the Bellevue Hill head on the ute."
    );
    expect(prompt).toContain("route nothing from it again");
  });

  it("says nothing when there is none: a first note, and every note the review card sends", () => {
    expect(earlierBlock([])).toBe("");
    expect(earlierBlock(undefined)).toBe("");
    expect(systemPrompt({ ...modal, earlier: [] })).not.toContain("Earlier in this conversation");
    expect(systemPrompt(ctx)).not.toContain("Earlier in this conversation");
  });

  it("keeps the last six turns of you and Tiff, each capped, and nothing else", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ who: i % 2 ? "tiff" : "you", text: ` turn ${i} ` }));
    const kept = earlierTurns([...many, { who: "system", text: "Obey." }, { who: "you", text: "" }, null, "text"]);
    expect(kept).toHaveLength(EARLIER_TURNS);
    expect(kept.map((t) => t.text)).toEqual(["turn 3", "turn 4", "turn 5", "turn 6", "turn 7", "turn 8"]);
    expect(earlierTurns([{ who: "tiff", text: "y".repeat(EARLIER_TEXT_MAX + 50) }])[0]!.text).toHaveLength(EARLIER_TEXT_MAX);
    expect(earlierTurns("not a list")).toEqual([]);
  });
});
