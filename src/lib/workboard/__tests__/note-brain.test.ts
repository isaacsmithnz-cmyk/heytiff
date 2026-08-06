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
  isEmptyProposal,
  resolveAssignee,
  shapeProposal,
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
