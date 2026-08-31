/* The routing rules the schema can't enforce.

   `output_config.format` guarantees the model returns valid JSON in the right
   shape. It cannot guarantee that "Luke" is a real person, that a severity is
   one we render, or that an unresolvable name becomes a question instead of a
   guess. That's what shapeProposal does, and it's what this file pins —
   especially the two-Lukes case, because assigning real work to the wrong
   person is the one failure this feature must not have. */

/* The real module is imported, SDK and all — jest.setup.ts polyfills the
   TextEncoder the SDK reaches for at import time. Nothing below makes a call:
   every rule under test is a pure function, which is exactly why they were
   written as pure functions. */
import {
  historyBlock,
  isEmptyProposal,
  resolveAssignee,
  shapeProposal,
  systemPrompt,
  whenBlock,
  whoBlock,
  SEVERITIES,
  type NoteContext,
} from "../note-brain";

const STAFF = [
  { id: "s-luke-n", fullName: "Luke Nguyen" },
  { id: "s-mick", fullName: "Mick Farrow" },
  { id: "s-jo", fullName: "Jo Baker" },
];

const ctx: NoteContext = { staff: STAFF, todayISO: "2026-07-28" };
const twoLukes: NoteContext = {
  ...ctx,
  staff: [...STAFF, { id: "s-luke-t", fullName: "Luke Tran" }],
};

/* The note is being dictated BY somebody. Isaac is on the roster like anyone
   else — the author is not a fourth kind of person, it is which of the three
   is holding the phone. */
const ISAAC = { id: "s-isaac", fullName: "Isaac Smith" };
const spoken: NoteContext = {
  ...ctx,
  staff: [...STAFF, ISAAC],
  author: ISAAC,
  dayStart: "06:30",
  dayEnd: "15:00",
};

/** A well-formed model response; tests override the parts they're about. */
const raw = (over: Record<string, unknown> = {}) => ({
  tasks: [],
  bring_items: [],
  flags: [],
  progress_bullets: [],
  commissioning_entries: [],
  issue_entries: [],
  kb_entries: [],
  note_lines: [],
  plain_note: "",
  clarify_needed: false,
  clarify_question: "",
  clarify_options: [],
  ...over,
});

describe("resolveAssignee", () => {
  it("matches on the first name, which is how a site note says it", () => {
    expect(resolveAssignee("Luke", STAFF)).toEqual({ kind: "one", id: "s-luke-n" });
    expect(resolveAssignee("  luke  ", STAFF)).toEqual({ kind: "one", id: "s-luke-n" });
  });

  it("matches a full name", () => {
    expect(resolveAssignee("Mick Farrow", STAFF)).toEqual({ kind: "one", id: "s-mick" });
  });

  it("REFUSES TO GUESS between two people with the same first name", () => {
    const match = resolveAssignee("Luke", twoLukes.staff);
    expect(match.kind).toBe("ambiguous");
    if (match.kind === "ambiguous") {
      expect(match.names.sort()).toEqual(["Luke Nguyen", "Luke Tran"]);
    }
  });

  it("a full name still resolves even when the first name is ambiguous", () => {
    expect(resolveAssignee("Luke Tran", twoLukes.staff)).toEqual({ kind: "one", id: "s-luke-t" });
  });

  it("an unknown or empty name matches nobody", () => {
    expect(resolveAssignee("Dave", STAFF)).toEqual({ kind: "none" });
    expect(resolveAssignee("   ", STAFF)).toEqual({ kind: "none" });
  });
});

describe("shapeProposal — tasks", () => {
  it("routes 'tell Luke to order the grilles' to a real person", () => {
    const p = shapeProposal(
      raw({
        tasks: [
          {
            title: "Order the grilles",
            detail: "For Smith St — 4 × 595 return air",
            assignee_hint: "Luke",
            due_hint: "before the next visit",
          },
        ],
      }),
      ctx
    );
    expect(p.tasks).toHaveLength(1);
    expect(p.tasks[0]).toMatchObject({
      title: "Order the grilles",
      assigneeId: "s-luke-n",
      assigneeHint: "Luke",
      dueHint: "before the next visit",
    });
    expect(p.clarify).toBeNull();
  });

  it("an ambiguous name becomes a QUESTION, and the task keeps no assignee", () => {
    const p = shapeProposal(
      raw({ tasks: [{ title: "Order the grilles", detail: "", assignee_hint: "Luke", due_hint: "" }] }),
      twoLukes
    );
    // the task survives — it's real work — but nobody is assigned to it
    expect(p.tasks[0].assigneeId).toBeNull();
    expect(p.tasks[0].assigneeHint).toBe("Luke");
    expect(p.clarify?.question).toContain("Luke");
    expect(p.clarify?.options.sort()).toEqual(["Luke Nguyen", "Luke Tran"]);
  });

  it("an unknown name leaves the task unassigned rather than dropping it", () => {
    const p = shapeProposal(
      raw({ tasks: [{ title: "Chase the sparky", detail: "", assignee_hint: "Dave", due_hint: "" }] }),
      ctx
    );
    expect(p.tasks).toHaveLength(1);
    expect(p.tasks[0].assigneeId).toBeNull();
  });

  it("drops a task with no title — that isn't a task", () => {
    const p = shapeProposal(
      raw({ tasks: [{ title: "   ", detail: "something", assignee_hint: "Luke", due_hint: "" }] }),
      ctx
    );
    expect(p.tasks).toEqual([]);
  });
});

describe("shapeProposal — the other lanes", () => {
  it("carries data-lane content through without inventing actions", () => {
    const p = shapeProposal(
      raw({
        progress_bullets: ["Rough-in finished on level 2"],
        commissioning_entries: [{ body: "Superheat 6K, subcool 9K", equipment_hint: "Unit 3" }],
        issue_entries: [{ summary: "Tripped on high pressure again", equipment_hint: "middle rooftop" }],
        plain_note: "Customer mentioned they're away in August.",
      }),
      ctx
    );
    expect(p.progressBullets).toEqual(["Rough-in finished on level 2"]);
    expect(p.commissioningEntries[0]).toEqual({
      body: "Superheat 6K, subcool 9K",
      equipmentHint: "Unit 3",
    });
    expect(p.issueEntries[0].body).toBe("Tripped on high pressure again");
    expect(p.plainNote).toContain("away in August");
    // the point: none of that became a task
    expect(p.tasks).toEqual([]);
  });

  it("keeps only severities we render, degrading the rest to warn", () => {
    const p = shapeProposal(
      raw({
        flags: [
          { message: "No roof access booked", severity: "urgent" },
          { message: "Filter looking rough", severity: "catastrophic" },
          { message: "Gate code changed", severity: "info" },
        ],
      }),
      ctx
    );
    expect(p.flags.map((f) => f.severity)).toEqual(["urgent", "warn", "info"]);
    for (const f of p.flags) expect(SEVERITIES).toContain(f.severity);
  });

  it("survives junk where objects and arrays were expected", () => {
    const p = shapeProposal(
      { tasks: "nope", flags: null, bring_items: [1, "2 × filters", null], plain_note: 42 },
      ctx
    );
    expect(p.tasks).toEqual([]);
    expect(p.flags).toEqual([]);
    expect(p.bringItems).toEqual(["2 × filters"]);
    expect(p.plainNote).toBe("");
  });

  it("shapes a wholly unusable response into an empty proposal, not a crash", () => {
    for (const junk of [null, undefined, "text", 7, []]) {
      expect(isEmptyProposal(shapeProposal(junk, ctx))).toBe(true);
    }
  });
});

describe("one note, several outcomes", () => {
  it("splits a real dictation across lanes at once", () => {
    // "Tell Luke he needs to order the grilles for this, the middle rooftop
    //  unit tripped again, and we'll need the 595 filters next visit."
    const p = shapeProposal(
      raw({
        tasks: [{ title: "Order the grilles", detail: "", assignee_hint: "Luke", due_hint: "" }],
        issue_entries: [{ summary: "Tripped again", equipment_hint: "middle rooftop unit" }],
        bring_items: ["2 × 595 filters"],
      }),
      ctx
    );
    expect(p.tasks[0].assigneeId).toBe("s-luke-n");
    expect(p.issueEntries).toHaveLength(1);
    expect(p.bringItems).toEqual(["2 × 595 filters"]);
    expect(isEmptyProposal(p)).toBe(false);
  });

  it("a note that is only a remark proposes nothing to do", () => {
    const p = shapeProposal(raw({ plain_note: "Nice dog on site." }), ctx);
    expect(isEmptyProposal(p)).toBe(true);
    expect(p.plainNote).toBe("Nice dog on site.");
  });
});

describe("clarify", () => {
  it("passes the model's own question through with its options", () => {
    const p = shapeProposal(
      raw({
        clarify_needed: true,
        clarify_question: "Is that a task for someone, or just a note?",
        clarify_options: ["Task", "Just a note"],
      }),
      ctx
    );
    expect(p.clarify).toEqual({
      question: "Is that a task for someone, or just a note?",
      options: ["Task", "Just a note"],
    });
  });

  it("ignores clarify_needed when no question came with it", () => {
    expect(shapeProposal(raw({ clarify_needed: true, clarify_question: "  " }), ctx).clarify).toBeNull();
  });

  it("a question the model DID ask wins over the ambiguity we detected", () => {
    // one question at a time — the card asks the model's, then re-runs
    const p = shapeProposal(
      raw({
        tasks: [{ title: "Order grilles", detail: "", assignee_hint: "Luke", due_hint: "" }],
        clarify_needed: true,
        clarify_question: "Which site is this for?",
        clarify_options: ["Smith St", "Warehouse"],
      }),
      twoLukes
    );
    expect(p.clarify?.question).toBe("Which site is this for?");
    expect(p.tasks[0].assigneeId).toBeNull();
  });
});

describe("shapeProposal — the LEARN lane", () => {
  it("keeps a titled method and its body", () => {
    const p = shapeProposal(
      raw({
        kb_entries: [
          {
            title: "Clearing an E6 without the manual",
            body: "Power the outdoor board separately before resetting.",
          },
        ],
      }),
      ctx
    );
    expect(p.kbEntries).toEqual([
      {
        title: "Clearing an E6 without the manual",
        body: "Power the outdoor board separately before resetting.",
      },
    ]);
  });

  it("a blank title falls back to the body's opening words — knowledge beats a heading", () => {
    const p = shapeProposal(
      raw({ kb_entries: [{ title: "  ", body: "Isolate the condensate pump first." }] }),
      ctx
    );
    expect(p.kbEntries[0].title).toBe("Isolate the condensate pump first.");
  });

  it("a body-less entry is dropped — a card with no method is not knowledge", () => {
    const p = shapeProposal(raw({ kb_entries: [{ title: "A trick", body: "" }] }), ctx);
    expect(p.kbEntries).toHaveLength(0);
  });

  it("outside a debrief, stray note_lines fold into the plain note rather than vanish", () => {
    const p = shapeProposal(raw({ note_lines: ["ring the wholesaler"], plain_note: "gate 4417" }), ctx);
    expect(p.noteLines).toEqual([]);
    expect(p.plainNote).toBe("gate 4417 · ring the wholesaler");
  });
});

describe("shapeProposal — debrief coercion", () => {
  const debriefCtx: NoteContext = { ...ctx, debrief: true };

  it("job-bound buckets become note lines — nothing a person said is dropped", () => {
    const p = shapeProposal(
      raw({
        flags: [{ message: "Meridian RTU-2 tripping", severity: "warn" }],
        bring_items: ["595 filters"],
        issue_entries: [{ summary: "compressor noisy at Smith St", equipment_hint: "" }],
        note_lines: ["chase the coil pricing"],
        plain_note: "long day tomorrow",
      }),
      debriefCtx
    );
    expect(p.flags).toEqual([]);
    expect(p.bringItems).toEqual([]);
    expect(p.issueEntries).toEqual([]);
    expect(p.plainNote).toBe("");
    expect(p.noteLines).toEqual([
      "chase the coil pricing",
      "Meridian RTU-2 tripping",
      "Bring next visit: 595 filters",
      "compressor noisy at Smith St",
      "long day tomorrow",
    ]);
  });

  it("tasks and knowledge pass through a debrief untouched", () => {
    const p = shapeProposal(
      raw({
        tasks: [{ title: "Order grilles", detail: "", assignee_hint: "Luke", due_hint: "" }],
        kb_entries: [{ title: "E6 trick", body: "Power the board separately." }],
      }),
      debriefCtx
    );
    expect(p.tasks).toHaveLength(1);
    expect(p.kbEntries).toHaveLength(1);
    expect(p.noteLines).toEqual([]);
  });
});

/* ── "REMIND ME" ──────────────────────────────────────────────────────────

   THE NOTE THAT MADE THIS EXIST, dictated into Tiff on 2026-08-22:

     "I need to check with Luke whether he sent the quote to Chris from Scott
      Group. Remind me to do that on Monday morning."

   The router did its half perfectly — one task, well titled, dated the right
   Monday. Then the card refused to save it: "One task still needs a person on
   it", with a cascade underneath reading "No tasks for anyone" while the task
   sat on screen a centimetre above. `resolveAssignee` only ever matched names,
   and nothing had told the router that a "me" was in the room, so the one task
   a person is most certain about — their own — was the one it could not
   produce.

   Both halves are pinned below: the person, and the time of day that the word
   "morning" used to be thrown away with. */
describe("a note that asks to be reminded", () => {
  const remindMe = (over: Record<string, unknown> = {}) =>
    raw({
      tasks: [
        {
          title: "Check with Luke about quote to Chris from Scott Group",
          detail: "Did the quote go out?",
          assignee_hint: "me",
          due_hint: "Monday morning",
          due_date: "2026-08-24",
          remind_time: "06:30",
          ...over,
        },
      ],
    });

  it("gives the task to the person who dictated it", () => {
    const p = shapeProposal(remindMe(), spoken);
    expect(p.tasks[0].assigneeId).toBe(ISAAC.id);
    // and the card no longer has anything to complain about
    expect(p.clarify).toBeNull();
  });

  it("keeps the time of day the note asked for", () => {
    expect(shapeProposal(remindMe(), spoken).tasks[0]).toMatchObject({
      dueDate: "2026-08-24",
      remindTime: "06:30",
    });
  });

  it("answers to 'me' in the language it was said in", () => {
    /* The model is told to leave `assignee_hint` in the note's own words and
       NOT to correct it, so a note dictated in Vietnamese arrives with "tôi"
       in that field. An English-only list hands that person the exact failure
       this whole thing exists to remove. */
    for (const said of ["me", "I", "myself", "tôi", "yo", "ako", "我"])
      expect(shapeProposal(remindMe({ assignee_hint: said }), spoken).tasks[0].assigneeId).toBe(
        ISAAC.id,
      );
  });

  it("still gives a NAMED person the task, not the speaker", () => {
    expect(shapeProposal(remindMe({ assignee_hint: "Luke" }), spoken).tasks[0].assigneeId).toBe(
      "s-luke-n",
    );
  });

  it("lets a real person beat a pronoun that happens to look like them", () => {
    /* A workspace is entitled to a member called Mi, and she is a person
       before she is a Spanish possessive. The self tokens are checked LAST,
       after every name, and this is the assertion that keeps them there. */
    const withMi: NoteContext = {
      ...spoken,
      staff: [...spoken.staff, { id: "s-mi", fullName: "Mi Tran" }],
    };
    expect(shapeProposal(remindMe({ assignee_hint: "Mi" }), withMi).tasks[0].assigneeId).toBe(
      "s-mi",
    );
  });

  it("assigns nobody when there is no author to be", () => {
    /* A surface that routes without an author gets the OLD behaviour — an
       unresolved hint and a card that asks — rather than a wrong person. */
    expect(shapeProposal(remindMe(), ctx).tasks[0].assigneeId).toBeNull();
  });

  it("refuses a time it cannot read rather than inventing one", () => {
    /* Same posture as the date beside it, and it matters more: this is
       composed into a real instant server-side, so "9pm-ish" reaching the
       database as a nudge is worse than no nudge at all. */
    for (const bad of ["9pm-ish", "6:30", "24:00", "06:60", "morning", "", null, 630])
      expect(shapeProposal(remindMe({ remind_time: bad }), spoken).tasks[0].remindTime).toBe("");
  });

  it("reads a deadline as a deadline, and anything else as an appointment", () => {
    /* "Back in the yard by four" and "service at half seven" are the same
       shape of sentence and the opposite instruction. The word decides which
       the rail draws, so an unreadable one has to fall to `at`: an
       appointment shown as a deadline is a false alarm, and false alarms are
       what teach people to stop reading the rail. */
    expect(shapeProposal(remindMe({ remind_kind: "by" }), spoken).tasks[0].remindKind).toBe("by");
    expect(shapeProposal(remindMe({ remind_kind: "at" }), spoken).tasks[0].remindKind).toBe("at");
    for (const bad of ["BY", "before", "deadline", "", null, 1, true, undefined])
      expect(shapeProposal(remindMe({ remind_kind: bad }), spoken).tasks[0].remindKind).toBe("at");
  });

  it("leaves an ordinary task without an alarm", () => {
    const p = shapeProposal(
      raw({
        tasks: [
          {
            title: "Order the grilles",
            detail: "",
            assignee_hint: "Luke",
            due_hint: "Friday",
            due_date: "2026-07-31",
            remind_time: "",
          },
        ],
      }),
      spoken,
    );
    expect(p.tasks[0]).toMatchObject({ dueDate: "2026-07-31", remindTime: "" });
  });
});

describe("what the router is told about who and when", () => {
  it("names the speaker, and how they will refer to themselves", () => {
    const said = whoBlock(spoken);
    expect(said).toContain("The person speaking is Isaac Smith");
    expect(said).toContain("`me` in `assignee_hint`");
  });

  it("says nothing about an author when there isn't one", () => {
    expect(whoBlock(ctx)).not.toContain("The person speaking");
    // but still lists who can be given work — the old behaviour, intact
    expect(whoBlock(ctx)).toContain("Luke Nguyen");
  });

  it("resolves morning against THIS person's day, not a number in the prompt", () => {
    /* The workspace already knows when this person starts. A model left to
       guess renders "morning" as 9am — ninety minutes after an installer's day
       has already begun, on the one feature whose entire job is being on time. */
    const said = whenBlock(spoken);
    expect(said).toContain('morning" -> 06:30');
    expect(said).toContain("knock-off, close of play -> 15:00");
    expect(whenBlock({ ...spoken, dayStart: "08:00", dayEnd: "16:30" })).toContain(
      'morning" -> 08:00',
    );
  });

  it("asks for a nudge even when the note names no time at all", () => {
    /* "Remind me on Monday" with no time word must not become a task with no
       alarm — they asked for a nudge, and a day with no time is a nudge that
       never comes. */
    expect(whenBlock(spoken)).toMatch(/asks to be reminded but names no time[\s\S]*06:30/);
  });

  it("carries both blocks into the real prompt, in both modes", () => {
    /* They were duplicated across the two variants once and drifted within two
       edits, which is why they are functions. */
    for (const mode of [spoken, { ...spoken, debrief: true }]) {
      const prompt = systemPrompt(mode);
      expect(prompt).toContain("The person speaking is Isaac Smith");
      expect(prompt).toContain("`remind_time` is the time of day to nudge them at");
      expect(prompt).toContain("`remind_kind` says how to READ that time");
      /* The instruction that keeps the rail trustworthy: when the model is
         unsure it must NOT reach for the louder answer. */
      expect(prompt).toContain("Use 'at'");
    }
  });
});

describe("historyBlock — the router's memory, rendered", () => {
  it("says nothing when there is nothing known", () => {
    expect(historyBlock(ctx)).toBe("");
    expect(historyBlock({ ...ctx, history: { issues: [], flags: [], recentNotes: [] } })).toBe("");
  });

  it("recites recorded issues with their counts, and the echo rule", () => {
    const block = historyBlock({
      ...ctx,
      history: {
        issues: [{ summary: "Middle rooftop unit tripping", occurrences: 3, lastSeen: "2026-08-02" }],
        flags: [],
        recentNotes: [],
      },
    });
    expect(block).toContain('"Middle rooftop unit tripping" — 3 times, last 2026-08-02');
    /* The load-bearing sentence: applyNote dedupes by EXACT summary match,
       so the model must be told to reuse the recorded wording. */
    expect(block).toContain("EXACTLY as recorded");
  });

  it("names active flags and forbids repeating them", () => {
    const block = historyBlock({
      ...ctx,
      history: { issues: [], flags: ["No roof access"], recentNotes: [] },
    });
    expect(block).toContain('"No roof access"');
    expect(block).toContain("Do not raise a flag that repeats");
  });

  it("caps every list — a long history must not eat the prompt", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      summary: `Issue ${i}`,
      occurrences: 1,
      lastSeen: "2026-08-01",
    }));
    const block = historyBlock({
      ...ctx,
      history: { issues: many, flags: [], recentNotes: [] },
    });
    expect(block).toContain("Issue 9");
    expect(block).not.toContain("Issue 10");
  });
});
