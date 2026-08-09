/* The check between the router and the review card.

   Same rule as note-brain.test.ts: the real module is imported, SDK and all,
   and nothing here makes a call — every branch that decides anything was
   written as a pure function so it could be pinned without one. What that
   leaves in `englishProposal` is a try/catch around one request.

   Two facts carry this file. A name is never translated (a translated name
   matches nobody on the roster), and no failure ever loses words. */

import {
  alignTranslations,
  englishProposal,
  foreignStrings,
  recordStrings,
  withTranslations,
} from "../note-english";
import type { NoteProposal } from "../note-brain";

const EMPTY: NoteProposal = {
  tasks: [],
  bringItems: [],
  flags: [],
  progressBullets: [],
  commissioningEntries: [],
  issueEntries: [],
  kbEntries: [],
  noteLines: [],
  plainNote: "",
  clarify: null,
};

const task = (over: Partial<NoteProposal["tasks"][number]> = {}) => ({
  title: "Order the grilles",
  detail: "Smith Street, ducted change-over",
  assigneeId: null,
  assigneeHint: "Luke",
  dueHint: "before Monday",
  dueDate: "2026-08-10",
  ...over,
});

describe("what the crew reads", () => {
  it("collects the fields the whole board sees", () => {
    const p: NoteProposal = {
      ...EMPTY,
      tasks: [task()],
      flags: [{ message: "Roof hatch padlock seized", severity: "warn" }],
      kbEntries: [{ title: "Clearing an E6", body: "Power the outdoor board separately" }],
      plainNote: "Front desk has the key",
      clarify: { question: "Which Luke?", options: ["Luke N", "Luke T"] },
    };
    const all = recordStrings(p);
    expect(all).toContain("Order the grilles");
    expect(all).toContain("Roof hatch padlock seized");
    expect(all).toContain("Clearing an E6");
    expect(all).toContain("Which Luke?");
  });

  it("never offers a name or a model string for translation", () => {
    /* THE ONE THING THAT MUST NOT MOVE: `resolveAssignee` matches the hint
       against the roster, and equipmentHint is a model string. */
    const p: NoteProposal = {
      ...EMPTY,
      tasks: [task({ assigneeHint: "Luke" })],
      commissioningEntries: [{ body: "Superheat 8K", equipmentHint: "PUZ-ZM250VKA" }],
    };
    const all = recordStrings(p);
    expect(all).not.toContain("Luke");
    expect(all).not.toContain("PUZ-ZM250VKA");
  });

  it("skips empty fields — there is nothing to repair in a blank", () => {
    expect(recordStrings(EMPTY)).toEqual([]);
    expect(foreignStrings(EMPTY)).toEqual([]);
  });
});

describe("what gets sent for repair", () => {
  it("picks out only the fields that aren't English", () => {
    const p: NoteProposal = {
      ...EMPTY,
      tasks: [task({ title: "Cambiar el filtro del rooftop", detail: "Smith Street" })],
      progressBullets: ["Checked the belts"],
    };
    expect(foreignStrings(p)).toEqual(["Cambiar el filtro del rooftop"]);
  });

  it("asks for the same phrase once, however many fields carry it", () => {
    const p: NoteProposal = {
      ...EMPTY,
      tasks: [task({ title: "Thay lọc gió", detail: "Thay lọc gió" })],
      progressBullets: ["Thay lọc gió"],
    };
    expect(foreignStrings(p)).toEqual(["Thay lọc gió"]);
  });
});

describe("the model's answer, aligned", () => {
  const originals = ["Cambiar el filtro", "Thay lọc gió"];

  it("maps each string to its own translation", () => {
    const map = alignTranslations(originals, ["Change the filter", "Change the air filter"]);
    expect(map.get("Cambiar el filtro")).toBe("Change the filter");
    expect(map.get("Thay lọc gió")).toBe("Change the air filter");
  });

  it("a short, long or malformed answer costs ONE string, never the batch", () => {
    /* Nothing here may throw away work that came back fine. */
    expect(alignTranslations(originals, ["Change the filter"]).size).toBe(1);
    expect(alignTranslations(originals, ["Change the filter", 42]).size).toBe(1);
    expect(alignTranslations(originals, ["Change the filter", "  "]).size).toBe(1);
    expect(alignTranslations(originals, "not an array").size).toBe(0);
    expect(alignTranslations(originals, undefined).size).toBe(0);
  });

  it("an unchanged string is not a translation", () => {
    expect(alignTranslations(originals, originals).size).toBe(0);
  });
});

describe("the repaired proposal", () => {
  it("swaps the text in wherever it appeared, and leaves the rest alone", () => {
    const p: NoteProposal = {
      ...EMPTY,
      tasks: [task({ title: "Thay lọc gió", detail: "Thay lọc gió", assigneeHint: "Dane" })],
      progressBullets: ["Thay lọc gió", "Checked the belts"],
      flags: [{ message: "Thay lọc gió", severity: "urgent" }],
    };
    const out = withTranslations(p, new Map([["Thay lọc gió", "Change the air filter"]]));

    expect(out.tasks[0].title).toBe("Change the air filter");
    expect(out.tasks[0].detail).toBe("Change the air filter");
    expect(out.progressBullets).toEqual(["Change the air filter", "Checked the belts"]);
    expect(out.flags[0].message).toBe("Change the air filter");
    // untouched: the name, the severity, the resolved date
    expect(out.tasks[0].assigneeHint).toBe("Dane");
    expect(out.tasks[0].dueDate).toBe("2026-08-10");
    expect(out.flags[0].severity).toBe("urgent");
  });

  it("carries a clarifying question and its options across", () => {
    const p: NoteProposal = {
      ...EMPTY,
      clarify: { question: "¿Cuál unidad?", options: ["RTU-1", "RTU-2"] },
    };
    const out = withTranslations(p, new Map([["¿Cuál unidad?", "Which unit?"]]));
    expect(out.clarify).toEqual({ question: "Which unit?", options: ["RTU-1", "RTU-2"] });
  });

  it("an empty map is a no-op, not an erasure", () => {
    const p: NoteProposal = { ...EMPTY, plainNote: "Front desk has the key" };
    expect(withTranslations(p, new Map())).toEqual(p);
  });
});

describe("an English proposal costs nothing", () => {
  it("returns without touching the model when there is nothing to repair", async () => {
    /* The whole design rests on this: the detector is pure and local, so an
       English note — every note, most days — pays a few string scans and no
       call at all. If this ever made a request it would fail here, with no
       key and no network. */
    const p: NoteProposal = {
      ...EMPTY,
      tasks: [task()],
      progressBullets: ["Checked the belts and the filters"],
    };
    await expect(englishProposal(p)).resolves.toBe(p);
  });
});
