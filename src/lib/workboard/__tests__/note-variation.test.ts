/* THE VARIATION LANE (v2 step 6, slice D) — the schema, the prompt rule,
   the shaper, the plan's rows, the record, and the cards. The server half
   (starting it through the quote page's own action, its gates, the task it
   becomes, Undo) is in actions/__tests__/workboard-notes-variations.test.ts.
   No model is called. */

import { NOTE_SCHEMA, TIFF_NOTE_SCHEMA, isEmptyProposal, rowLine, shapeProposal, systemBlocks, type NoteContext } from "../note-brain";
import { PLAN_LANES, planRows, storedProposal, toDraft, withoutRows } from "../note-draft";
import { recordStrings, withTranslations } from "../note-english";
import { appliedOf, doorsOf, startedOn, takesBack, undoSummary } from "../note-applied";
import {
  variationCards,
  variationDoneLine,
  variationFields,
  variationHref,
  variationRefusedLine,
  variationsOf,
  variationTaskDetail,
  variationTaskTitle,
  variationTitle,
  variationUndoneLine,
  type VariationMade,
} from "../note-variation";
import { planView, withVariationCards } from "@/components/tiff/modal/plan-view";


const ctx: NoteContext = {
  staff: [{ id: "s-me", fullName: "Isaac Smith" }],
  todayISO: "2026-10-18",
  author: { id: "s-me", fullName: "Isaac Smith" },
  askWho: true,
  speak: true,
};

const raw = (variations: unknown[], over: Record<string, unknown> = {}) => ({
  tasks: [],
  visits: [],
  costs: [],
  variations,
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

const JOB = "0000000b-0000-4000-8000-000000003209";
const started = (over: Partial<VariationMade> = {}): VariationMade => ({
  index: 0,
  how: "started",
  why: null,
  what: "return grille in Bed 2",
  jobUuid: JOB,
  n: 1,
  option: 1,
  taskId: null,
  undone: false,
  ...over,
});

describe("the schema", () => {
  it("has a variations lane: what's changing, required, never nullable", () => {
    for (const schema of [NOTE_SCHEMA, TIFF_NOTE_SCHEMA]) {
      const lane = (schema.properties as Record<string, unknown>).variations as { type: string; items: { properties: Record<string, { type: string }>; required: string[] } };
      expect(lane.type).toBe("array");
      expect(Object.keys(lane.items.properties)).toEqual(["what"]);
      expect(lane.items.properties.what.type).toBe("string");
      expect(lane.items.required).toEqual(["what"]);
      expect(schema.required).toContain("variations");
    }
    expect(JSON.stringify(TIFF_NOTE_SCHEMA)).not.toMatch(/"null"|nullable|anyOf/);
  });
});

describe("the prompt rule", () => {
  const head = systemBlocks(ctx)[0]!.text;
  const rule = head.slice(head.indexOf("- variations:"), head.indexOf("- bring_items:"));

  it("is in the cached head, said once, short: 133 characters, about 45 tokens", () => {
    expect(head).toContain("- variations: the client wants the accepted quote changed, 'add a");
    expect(head).toContain("Not also a task.");
    expect(head.match(/- variations:/g)).toHaveLength(1);
    expect(rule.length).toBe(133);
  });

  it("names nobody and no day: the head is the same bytes for every note", () => {
    expect(systemBlocks({ staff: [], todayISO: "2027-01-01" })[0]!.text).toBe(head);
  });
});

describe("the shaper", () => {
  it("reads what the client wants changed, in a few words, one a note", () => {
    const p = shapeProposal(raw([{ what: "  return grille in Bed 2. " }, { what: "and a second one" }]), ctx);
    expect(p.variations).toEqual([{ what: "return grille in Bed 2" }]);
    expect(isEmptyProposal(p)).toBe(false);
  });

  it("drops one that says nothing to change", () => {
    expect(shapeProposal(raw([{ what: "  " }, { nope: 1 }]), ctx).variations).toEqual([]);
    expect(variationFields({ what: 42 })).toBeNull();
  });

  it("is a lane of the plan: a row, a cross that takes it off, kept when stored, told to the router", () => {
    const p = shapeProposal(raw([{ what: "return grille in Bed 2" }]), ctx);
    expect(PLAN_LANES).toContain("variations");
    expect(planRows(p)).toEqual([{ key: "variations:0", lane: "variations", index: 0, text: "return grille in Bed 2" }]);
    expect(toDraft(p).variations).toEqual([{ what: "return grille in Bed 2", on: true }]);
    expect(withoutRows(toDraft(p), ["variations:0"]).variations[0]!.on).toBe(false);
    expect(storedProposal(JSON.parse(JSON.stringify(p)))!.variations).toEqual([{ what: "return grille in Bed 2" }]);
    /* a proposal stored before the lane has none */
    expect(storedProposal({ tasks: [] })!.variations).toEqual([]);
    expect(rowLine(planRows(p)[0]!, p, [])).toBe("Variation to the accepted quote: return grille in Bed 2");
    expect(recordStrings(p)).toContain("return grille in Bed 2");
    expect(withTranslations(p, new Map([["return grille in Bed 2", "return grille, Bed 2"]])).variations).toEqual([{ what: "return grille, Bed 2" }]);
    expect(planView(p, [], false)[0]).toMatchObject({ lane: "variations", lead: "Variation", text: "return grille in Bed 2" });
  });
});

describe("what it became", () => {
  it("reads the record back as written, and drops what isn't one", () => {
    expect(variationsOf([started(), { index: 1, how: "started" }, { index: 2, how: "made up" }, "x"])).toEqual([started()]);
    const task = started({ index: 1, how: "task", why: "money", n: null, option: null, taskId: "t-1" });
    expect(variationsOf([task])).toEqual([task]);
    expect(appliedOf({ variations: [started()] }).variations).toEqual([started()]);
  });

  it("is a card: 'Started variation 1: return grille in Bed 2', with Open on the quote page and Undo", () => {
    expect(variationTitle(started())).toBe("Started variation 1: return grille in Bed 2");
    expect(variationCards([started()])).toEqual([
      {
        index: 0,
        how: "started",
        title: "Started variation 1: return grille in Bed 2",
        line: "A draft to change and price on the quote.",
        href: `/dashboard/jobs/${JOB}/quote?option=1`,
        undo: true,
      },
    ]);
    expect(variationHref(JOB, 3)).toBe(`/dashboard/jobs/${JOB}/quote?option=3`);
    /* one taken back has no card */
    expect(variationCards([started({ undone: true })])).toEqual([]);
  });

  it("lays its card over its row once filed, the row's Open on the quote", () => {
    const p = shapeProposal(raw([{ what: "return grille in Bed 2" }], { tasks: [] }), ctx);
    const rows = withVariationCards(planView(p, [], false), variationCards([started()]));
    expect(rows[0]).toMatchObject({ text: "Started variation 1: return grille in Bed 2", open: `/dashboard/jobs/${JOB}/quote?option=1` });
    expect(withVariationCards(planView(p, [], false), undefined)[0]!.open).toBeUndefined();
  });

  it("is what the note's Undo takes back, and its doors and summary count it", () => {
    const a = appliedOf({ v: 2, variations: [started()] });
    expect(startedOn(a)).toHaveLength(1);
    expect(takesBack(a)).toBe(true);
    expect(doorsOf(a)).toEqual([{ kind: "variations", count: 1, label: "1 variation started", ids: [] }]);
    expect(undoSummary(a)).toBe("1 variation taken back.");
    /* one taken back by its own Undo is not counted again; a task goes with the tasks */
    expect(takesBack(appliedOf({ v: 2, variations: [started({ undone: true })] }))).toBe(false);
    expect(startedOn(appliedOf({ variations: [started({ how: "task", why: "money", taskId: "t-1" })] }))).toEqual([]);
  });
});

describe("what Tiff says", () => {
  it("says what she started, and that nothing goes until it's approved", () => {
    expect(variationDoneLine(started())).toBe(
      "Started variation 1: return grille in Bed 2. It's a copy of the accepted quote to change and price; nothing goes to the client or ServiceM8 until it's approved.",
    );
  });

  it("says a job with no accepted quote has no variation, and makes it a task instead", () => {
    const t = started({ how: "task", why: "unaccepted", n: null, option: null, taskId: "t-1" });
    expect(variationDoneLine(t)).toBe(
      "Nothing is accepted on this job's quote in HeyTiff, so there's no variation to start; a quote accepted in ServiceM8 has no lines here to copy. Reprice it from the Quote tab. I've made it a task instead: Add to the quote: return grille in Bed 2.",
    );
    expect(variationTaskDetail("unaccepted", "#3209 Richards")).toBe(
      "Nothing is accepted on the quote on #3209 Richards in HeyTiff yet, so this changes the quote itself rather than starting a variation: reprice it from the job's Quote tab.",
    );
  });

  it("says why someone without money access gets a task", () => {
    const t = started({ how: "task", why: "money", n: null, option: null, taskId: "t-1" });
    expect(variationDoneLine(t)).toBe("Starting a variation needs money access, so I've made it a task for you: Start variation: return grille in Bed 2.");
    expect(variationTaskTitle("return grille in Bed 2", "money")).toBe("Start variation: return grille in Bed 2");
    expect(variationTaskDetail("money", null)).toBe("Starting a variation needs money access: someone who has it starts it on the job's quote.");
  });

  it("says a refusal in its own words, and what Undo took back", () => {
    expect(variationRefusedLine("return grille in Bed 2", "Nothing's accepted yet: change the quote itself.")).toBe(
      "The variation for return grille in Bed 2 wasn't started. Nothing's accepted yet: change the quote itself.",
    );
    expect(variationUndoneLine(started())).toBe("Variation 1 taken back.");
    expect(variationUndoneLine(started({ how: "task", why: "money" }))).toBe('The task "Start variation: return grille in Bed 2" taken back.');
  });
});
