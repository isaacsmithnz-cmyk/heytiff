/* Check the read, one question at a time (Isaac, 26 November 2026: "make
   check the read workflow smooth"): what a read set asks, drawn on a set
   like the one that raised it, a window and door plan read as a second
   ground floor and a lower ground floor holding only its garage. */

import type { JobPlan, JobPlanPage } from "../plans";
import { answeredSaid, readQuestions, sheetTitleOf, titleSaysFloor } from "../read-questions";

const room = (name: string) => ({ name, named: true, kind: "room" as const, outline: [], written: "", existing: false, openTo: "", stair: "" });
const sheet = (n: number, names: string[]) => ({ sheetId: `p${n}`, spaces: names.map(room), openings: [], marks: [], furniture: [], checklist: [], flags: [], planUp: "" });
const titleBlock = (title: string) => [
  { text: "Sheet Name :", at: { x: 1500, y: 1641 } },
  { text: "Construction Drawings", at: { x: 1208, y: 1606 } },
  { text: title, at: { x: 1690, y: 1640 } },
];
const page = (n: number, level: number, name: string, title: string | null, over: Partial<JobPlanPage> = {}): JobPlanPage => ({
  n,
  kind: "floor",
  name,
  level,
  ref: `org/o/p${n}.png`,
  preview: `org/o/p${n}.jpeg`,
  width: 2400,
  height: 1697,
  mmPerPx: 17.5,
  scale: "1:100 @ A3",
  words: title ? titleBlock(title) : [],
  ...over,
});

const plan = (pages: JobPlanPage[], floors: Record<number, string[]>): JobPlan => ({
  id: "jplan_1",
  jobUuid: "job-1",
  documentId: "doc-1",
  attachmentId: null,
  name: "Drawing set.pdf",
  sourceRef: "org/o/src.pdf",
  sourceKind: "pdf",
  pageCount: 20,
  pages,
  reading: { at: "2026-11-26T09:07:00Z", model: "m", floors: Object.fromEntries(Object.entries(floors).map(([n, names]) => [`p${n}`, [sheet(Number(n), names)]])), failed: [], roof: null, site: null },
  state: "check",
  said: "x",
  addedBy: "Isaac Smith",
  addedAt: "2026-11-26T09:04:00Z",
  readAt: "2026-11-26T09:07:00Z",
});

const SET = plan(
  [
    page(6, -1, "Lower Ground Floor", "Lower Ground Floor - Proposed"),
    page(8, 0, "Ground floor", "Ground Floor Plan - Proposed"),
    page(9, 1, "Level 1", "L1 - Proposed"),
    page(18, 0, "Ground floor", "Window & Door Plans"),
  ],
  { 6: ["Garage"], 8: ["Bed 1", "Lounge", "Kitchen"], 9: ["Study", "Bed 4"], 18: ["Bed 1", "Lounge"] }
);

describe("a page's sheet title", () => {
  it("is the words beside its Sheet Name label", () => {
    expect(sheetTitleOf(SET.pages[1])).toBe("Ground Floor Plan - Proposed");
    expect(sheetTitleOf(SET.pages[3])).toBe("Window & Door Plans");
  });
  it("is the words under the label where the block prints it above", () => {
    expect(sheetTitleOf({ words: [{ text: "Drawing Title", at: { x: 100, y: 100 } }, { text: "First Floor Plan", at: { x: 120, y: 130 } }] })).toBe("First Floor Plan");
  });
  it("is nothing without a label, or without words", () => {
    expect(sheetTitleOf({ words: [{ text: "Ground Floor Plan", at: { x: 1, y: 1 } }] })).toBeNull();
    expect(sheetTitleOf({})).toBeNull();
  });
  it("says a floor plan only for a floor's own drawing", () => {
    expect(titleSaysFloor("Ground Floor Plan - Proposed")).toBe(true);
    expect(titleSaysFloor("Lower Ground Floor - Proposed")).toBe(true);
    expect(titleSaysFloor("Window & Door Plans")).toBe(false);
    expect(titleSaysFloor("Ground Floor Electrical Plan")).toBe(false);
    expect(titleSaysFloor(null)).toBe(false);
  });
});

describe("the questions a read set asks", () => {
  it("asks which of two pages at one level is the floor first, with the titles, Tiff's pick and what each does", () => {
    const [level] = readQuestions(SET);
    expect(level.ask).toBe("Pages 8 and 18 both read as Ground floor. Which is the Ground floor plan?");
    expect(level.why).toBe("Page 8 is titled Ground Floor Plan - Proposed. Page 18 is titled Window & Door Plans.");
    expect(level.pages).toEqual([8, 18]);
    expect(level.answers.map((a) => [a.label, a.does, !!a.likely])).toEqual([
      ["Page 8 is the Ground floor", "Page 18 leaves the floors, its picture kept", true],
      ["Page 18 is the Ground floor", "Page 8 leaves the floors, its picture kept", false],
      ["Both, each a part of it", "Both stay at Ground floor", false],
    ]);
    expect(level.answers[0].chosen).toEqual({ 8: "0", 18: "none" });
    expect(level.answers[2].chosen).toEqual({ 8: "0", 18: "0" });
  });

  it("then asks whether a page with one room is its floor, keeping it where its title says so", () => {
    const [, rooms] = readQuestions(SET);
    expect(rooms.ask).toBe("Page 6 has one room on it, the garage. Is it the Lower Ground Floor?");
    expect(rooms.why).toBe("It's titled Lower Ground Floor - Proposed.");
    expect(rooms.answers.map((a) => [a.label, !!a.likely])).toEqual([
      ["Yes, the Lower Ground Floor", true],
      ["Not a floor plan", false],
    ]);
    expect(rooms.answers[1].chosen).toEqual({ 6: "none" });
    expect(readQuestions(SET)).toHaveLength(2);
  });

  it("asks a page once, and nothing of a page somebody chose", () => {
    const picked = { by: "Isaac Smith", at: "2026-11-26T10:00:00Z" };
    const set = plan([page(8, 0, "Ground floor", null), page(18, 0, "Ground floor", null)], { 8: ["Bed 1"], 18: ["Bed 1"] });
    expect(readQuestions(set).map((q) => q.key)).toEqual(["level:0"]);
    expect(readQuestions(set)[0].answers.some((a) => a.likely)).toBe(false);
    expect(readQuestions({ ...set, pages: set.pages.map((p) => ({ ...p, picked })) })).toEqual([]);
  });

  it("asks nothing of a set still being read, or one read sure", () => {
    expect(readQuestions({ ...SET, state: "reading" })).toEqual([]);
    expect(readQuestions(plan([page(8, 0, "Ground floor", null)], { 8: ["Bed 1", "Lounge"] }))).toEqual([]);
  });

  it("says which pages left the floors", () => {
    expect(answeredSaid({ 8: "0", 18: "none" })).toBe("Page 18 left the floors");
    expect(answeredSaid({ 6: "none", 18: "none" })).toBe("Pages 6 and 18 left the floors");
    expect(answeredSaid({ 6: "-1" })).toBeNull();
  });
});
