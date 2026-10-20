/* THE VISIT LANE (v2 step 6, slice B) — the schema, the prompt rule, the
   shaper, and the pure half of "which time?". The server half (booking
   through Book in's gate, the answer, Undo) is in
   actions/__tests__/workboard-notes-visits.test.ts. No model is called. */

import {
  NOTE_SCHEMA,
  TIFF_NOTE_SCHEMA,
  isEmptyProposal,
  rowLine,
  shapeProposal,
  systemBlocks,
  type NoteContext,
} from "../note-brain";
import { planRows, storedProposal, toDraft, withoutRows } from "../note-draft";
import {
  ANOTHER_TIME,
  bookTaskTitle,
  dayWord,
  freeStarts,
  startFromWords,
  visitCards,
  visitDoneLine,
  visitMinutes,
  visitQuestion,
  visitStart,
  visitsOf,
  type VisitMade,
} from "../note-visit";
import { appliedOf, doorsOf, takesBack, undoSummary } from "../note-applied";

const STAFF = [
  { id: "s-lyle", fullName: "Lyle Irving" },
  { id: "s-callum", fullName: "Callum Reid" },
];
const ctx: NoteContext = {
  staff: STAFF,
  todayISO: "2026-10-13",
  author: { id: "s-me", fullName: "Isaac Smith" },
  askWho: true,
  speak: true,
};

const raw = (visits: unknown[], over: Record<string, unknown> = {}) => ({
  tasks: [],
  visits,
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

const visit = (over: Record<string, unknown> = {}) => ({
  work: "commissioning",
  assignee_hint: "Lyle",
  day: "2026-10-16",
  start: "",
  part: "afternoon",
  minutes: 0,
  ...over,
});

describe("the schema", () => {
  type Lane = { type: string; items: { properties: Record<string, { type: string; enum?: string[] }>; required: string[] } };

  it("has a visits lane, every field required and none nullable", () => {
    for (const schema of [NOTE_SCHEMA, TIFF_NOTE_SCHEMA]) {
      const lane = (schema.properties as Record<string, unknown>).visits as Lane;
      expect(lane.type).toBe("array");
      expect(Object.keys(lane.items.properties).sort()).toEqual(
        ["assignee_hint", "day", "minutes", "part", "start", "work"],
      );
      expect(lane.items.required.sort()).toEqual(Object.keys(lane.items.properties).sort());
      expect(lane.items.properties.part.enum).toEqual(["morning", "afternoon", "day"]);
      expect(lane.items.properties.minutes.type).toBe("integer");
      expect(schema.required).toContain("visits");
    }
  });

  it("stays well under the structured outputs limit of 16 nullable fields: it adds none", () => {
    expect(JSON.stringify(TIFF_NOTE_SCHEMA)).not.toMatch(/"null"|nullable|anyOf/);
  });
});

describe("the prompt rule", () => {
  const head = systemBlocks(ctx)[0]!.text;

  it("is in the cached head, said once, in the lanes' own voice", () => {
    expect(head).toContain("- visits: a visit to book, 'book commissioning for Friday arvo'.");
    expect(head).toContain("`start` HH:MM only when a clock time is said");
    expect(head).toContain("A visit is not also a task.");
    expect(head.match(/- visits:/g)).toHaveLength(1);
  });

  it("names nobody and no day: the head is the same bytes for every note", () => {
    expect(systemBlocks({ staff: [], todayISO: "2027-01-01" })[0]!.text).toBe(head);
  });
});

describe("the shaper", () => {
  it("accepts a visit with no clear time: the person resolved, the part kept, no start", () => {
    const p = shapeProposal(raw([visit()]), ctx);
    expect(p.visits).toEqual([
      {
        work: "commissioning",
        assigneeId: "s-lyle",
        assigneeHint: "Lyle",
        day: "2026-10-16",
        start: "",
        part: "afternoon",
        minutes: 0,
      },
    ]);
    expect(p.clarify).toBeNull();
    expect(isEmptyProposal(p)).toBe(false);
  });

  it("puts a clock time on Book in's 15-minute grid and a length on its lengths", () => {
    const p = shapeProposal(raw([visit({ start: "14:10", minutes: 100 })]), ctx);
    expect(p.visits[0]).toMatchObject({ start: "14:15", minutes: 90 });
    expect(visitStart("2pm")).toBe("");
    expect(visitStart("23:55")).toBe("");
    expect(visitMinutes(0)).toBe(0);
    expect(visitMinutes("two hours")).toBe(0);
  });

  it("drops what isn't a visit and what isn't a day, and reads an unknown part as the whole day", () => {
    const p = shapeProposal(
      raw([visit({ work: " " }), visit({ day: "2026-02-31", part: "evening" }), visit(), visit(), visit()]),
      ctx,
    );
    expect(p.visits).toHaveLength(3); // VISITS_MAX
    expect(p.visits[0]).toMatchObject({ day: "", part: "day" });
  });

  it("asks who when two people answer to the name, or nobody does", () => {
    const two = shapeProposal(raw([visit()]), { ...ctx, staff: [...STAFF, { id: "s-lyle-t", fullName: "Lyle Tran" }] });
    expect(two.visits[0]!.assigneeId).toBeNull();
    expect(two.clarify).toEqual({ question: "Which Lyle did you mean?", options: ["Lyle I", "Lyle T"] });

    const nobody = shapeProposal(raw([visit({ assignee_hint: "" })]), ctx, "book commissioning for Friday arvo");
    expect(nobody.clarify).toEqual({ question: "Who's going: commissioning?", options: ["Me"] });
    expect(nobody.say).toBe("Who's going: commissioning?");
  });

  it("is a plan row the person can take off, and stored and read back whole", () => {
    const p = shapeProposal(raw([visit({ start: "14:00", minutes: 120 })]), ctx);
    expect(planRows(p)).toEqual([{ key: "visits:0", lane: "visits", index: 0, text: "commissioning" }]);
    expect(rowLine(planRows(p)[0]!, p, STAFF)).toBe("Visit for Lyle Irving: commissioning, 2026-10-16 14:00 120 min");
    expect(withoutRows(toDraft(p), ["visits:0"]).visits[0]!.on).toBe(false);
    expect(storedProposal(JSON.parse(JSON.stringify(p)))!.visits).toEqual(p.visits);
    // a proposal stored before the lane has none
    expect(storedProposal({ tasks: [] })!.visits).toEqual([]);
  });
});

describe("the crew's free starts", () => {
  const day = "2026-10-16";
  const base = { day, part: "afternoon" as const, minutes: 90, dayStart: "07:00", dayEnd: "17:00", now: "2026-10-13 09:00:00" };

  it("offers starts a whole visit apart, clear of what they have on", () => {
    expect(freeStarts({ ...base, busy: [{ start: `${day} 13:00:00`, end: `${day} 14:00:00` }] })).toEqual(["14:00", "15:30"]);
  });

  it("keeps inside their working day and the part asked for", () => {
    expect(freeStarts({ ...base, busy: [], minutes: 240 })).toEqual(["13:00"]);
    expect(freeStarts({ ...base, busy: [], part: "morning", minutes: 120 })).toEqual(["07:00", "09:00"]);
    expect(freeStarts({ ...base, busy: [{ start: `${day} 06:00:00`, end: `${day} 18:00:00` }] })).toEqual([]);
  });

  it("offers nothing already past", () => {
    expect(freeStarts({ ...base, busy: [], now: `${day} 14:20:00` })).toEqual(["14:30"]);
    expect(freeStarts({ ...base, busy: [], now: "2026-10-17 08:00:00" })).toEqual([]);
  });
});

describe("the question and its answers", () => {
  it("is the board's: the work, the day, which time, and who's free", () => {
    expect(
      visitQuestion({ work: "commissioning", day: "2026-10-16", today: "2026-10-13", name: "Lyle", part: "afternoon", starts: ["14:00", "15:30"], read: true }),
    ).toEqual({
      question: "Commissioning on Friday: which time? Lyle's free at both.",
      options: ["2:00 pm", "3:30 pm", ANOTHER_TIME],
    });
    expect(
      visitQuestion({ work: "rough-in", day: "2026-10-14", today: "2026-10-13", name: "Lyle", part: "morning", starts: [], read: true }).question,
    ).toBe("Rough-in tomorrow: which time? Lyle has nothing free that morning.");
    expect(
      visitQuestion({ work: "a service", day: "2026-10-30", today: "2026-10-13", name: "Lyle", part: "day", starts: [], read: false }),
    ).toEqual({ question: "A service on Friday 30 October: which time?", options: [ANOTHER_TIME] });
  });

  it("reads a tapped answer, or a time typed the way it is said", () => {
    expect(startFromWords("2:00 pm")).toBe("14:00");
    expect(startFromWords("3:30 pm")).toBe("15:30");
    expect(startFromWords("2pm")).toBe("14:00");
    expect(startFromWords("at 2")).toBe("14:00");
    expect(startFromWords("7.30")).toBe("07:30");
    expect(startFromWords("16:45")).toBe("16:45");
    expect(startFromWords("12 pm")).toBe("12:00");
    expect(startFromWords(ANOTHER_TIME)).toBeNull();
    expect(startFromWords("2:10 pm")).toBeNull();
    expect(dayWord("2026-10-13", "2026-10-13")).toBe("today");
  });
});

describe("what a visit became", () => {
  const made = (over: Partial<VisitMade> = {}): VisitMade => ({
    index: 0,
    how: "booked",
    work: "commissioning",
    staffId: "s-lyle",
    name: "Lyle",
    day: "2026-10-16",
    start: "14:00",
    minutes: 120,
    jobUuid: "job-1",
    rowIds: ["row-1"],
    taskId: null,
    undone: false,
    ...over,
  });

  it("is a card with its own Undo, and Tiff's line says what it is", () => {
    expect(visitCards([made()], "2026-10-13")).toEqual([
      { index: 0, how: "booked", title: "Commissioning", line: "Lyle, Friday 16 October, 2:00 to 4:00 pm", aside: "", undo: true },
    ]);
    expect(visitDoneLine(made(), null, "2026-10-13")).toBe("Booked: commissioning, Lyle, Friday 16 October, 2:00 to 4:00 pm.");
    expect(visitDoneLine(made({ how: "trial" }), null, "2026-10-13")).toMatch(/Trial run. Nothing went to ServiceM8.$/);
    expect(visitDoneLine(made({ how: "heytiff", rowIds: [], taskId: "t-1" }), "off", "2026-10-13")).toBe(
      "Commissioning is in HeyTiff only: Lyle, Friday 16 October, 2:00 to 4:00 pm. Bookings don't go to ServiceM8 here.",
    );
    const task = made({ how: "task", rowIds: [], taskId: "t-2", start: "" });
    expect(bookTaskTitle(task, "2026-10-13")).toBe("Book commissioning Friday");
    expect(visitDoneLine(task, "no_right", "2026-10-13")).toBe(
      "You can't book visits, so I've made it a task: Book commissioning Friday.",
    );
    expect(visitCards([made({ undone: true })], "2026-10-13")).toEqual([]);
  });

  it("is kept on the note's record, and its booking is what the note's Undo takes back", () => {
    const a = appliedOf({ v: 2, visits: [made(), { index: "x" }, made({ index: 1, how: "task", rowIds: [], taskId: "t-1" })] });
    expect(a.visits).toHaveLength(2);
    expect(visitsOf("nope")).toEqual([]);
    expect(takesBack(a)).toBe(true);
    expect(doorsOf(a)).toEqual([{ kind: "visits", count: 1, label: "1 visit booked", ids: ["row-1"] }]);
    expect(undoSummary(a)).toBe("1 visit taken back.");
    expect(takesBack(appliedOf({ v: 2, visits: [made({ undone: true })] }))).toBe(false);
  });
});
