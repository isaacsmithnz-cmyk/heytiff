/**
 * @jest-environment node
 */
/* Priced questions (slice 6.1): each answer shows what it does to the price
   before it's tapped, and a tap makes its changes as the person, with no
   call to Tiff. */
jest.mock("server-only", () => ({}));
const readLines = jest.fn();
const changeLine = jest.fn(async () => ({ ok: true, line: null }));
const addLine = jest.fn(async () => ({ ok: true, line: null }));
const removeLine = jest.fn(async () => ({ ok: true, line: null }));
jest.mock("../../lines-server", () => ({
  readLines: () => readLines(),
  changeLine: (...a: unknown[]) => (changeLine as jest.Mock)(...a),
  addLine: (...a: unknown[]) => (addLine as jest.Mock)(...a),
  removeLine: (...a: unknown[]) => (removeLine as jest.Mock)(...a),
}));
const readSession = jest.fn();
const addEvents = jest.fn(async () => undefined);
jest.mock("../store-server", () => ({
  readSession: () => readSession(),
  addEvents: (...a: unknown[]) => (addEvents as jest.Mock)(...a),
  holding: (s: { turnId: string | null }) => !!s.turnId,
}));
jest.mock("../../settings-query", () => ({ readQuoteSettings: jest.fn() }));
jest.mock("../../org-day-server", () => ({ readOrgDay: jest.fn() }));
const BOOK = [
  { key: "a|ZM125V", name: "PUZ-ZM125VKA2 single phase", category: "units", offers: [{ supplierKey: "a", supplierName: "A", code: "PUZ-ZM125VKA2", name: "PUZ-ZM125VKA2", netCents: 300000 }], cheapest: null, preferred: null, brand: null, quotes: 0 },
  { key: "a|ZM125Y", name: "PUZ-ZM125YKA2 three phase", category: "units", offers: [{ supplierKey: "a", supplierName: "A", code: "PUZ-ZM125YKA2", name: "PUZ-ZM125YKA2", netCents: 340000 }], cheapest: null, preferred: null, brand: null, quotes: 0 },
];
jest.mock("../tools-server", () => ({
  linePricer: () => ({
    book: async () => BOOK,
    hourCost: async () => 11200,
    supplier: async () => null,
    lineFor: async (l: { name: string }) => ({ ...l, costCents: 0 }),
    /* the words alone, as with no data pack */
    unitName: async (item: { name: string; code: string }, words: string) => {
      const { namedUnit, unitRoleOf } = jest.requireActual("../../unit-name");
      return namedUnit(unitRoleOf(null, item, { name: words }), words);
    },
  }),
}));

import type { QuoteLine } from "../../lines";
import { answerDeltas, answeredOf, filledQty, latestAsked, openQuestionsOf, plainNumber, typedFill, withChanges } from "../answers";
import { answerQuestion, answerTyped } from "../answers-server";
import { bookPrice, type Question } from "../tools";

const line = (o: Partial<QuoteLine>): QuoteLine => ({
  id: "x", version: 1, updatedAt: "", updatedBy: "", optionIndex: 0, system: "Downstairs", group: "Units", position: 0, name: "x",
  code: null, supplierKey: null, kind: "material", qty: 1, unit: "", costCents: 0, sellCents: null, source: "assumed", why: "", duct: false, ...o,
});
const settings = { unitMarkupPct: 25, materialMarkupPct: 40, chargeOutCents: 14000, dayHours: 8, contingency: null };
const outdoor = line({ id: "od", kind: "unit", name: "PUZ-ZM125VKA2 single phase", code: "PUZ-ZM125VKA2", costCents: 300000 });
const iso = line({ id: "iso", name: "Isolator 35 A", code: "ISO35", costCents: 2360 });
const price = (code: string, unit: QuoteLine["unit"]) => bookPrice(BOOK as never, code, unit);

const phase: Question = {
  question: "Single or three phase at the board?",
  why: "The outdoor and its isolator",
  answers: [
    { label: "Single phase", changes: [] },
    { label: "Three phase", changes: [{ op: "swap", lineId: "od", code: "PUZ-ZM125YKA2" }, { op: "remove", lineId: "iso" }] },
    { label: "Not sure", changes: [{ op: "swap", lineId: "gone", code: "PUZ-ZM125YKA2" }] },
  ],
};

describe("an answer's price", () => {
  it("is the quote priced with its changes, less the quote as it is", () => {
    /* the three-phase unit $400 more at cost, $500 at 25%; the isolator
       $23.60 off, $33.04 at 40% */
    expect(answerDeltas(phase, [outdoor, iso], price, 11200, settings)).toEqual([0, 46700, null]); // 50000 - 3304, to the nearest dollar
  });

  it("can't be made when its line has gone, or its item isn't in the book", () => {
    expect(withChanges([outdoor], [{ op: "swap", lineId: "od", code: "NOPE" }], price, null)).toBeNull();
    expect(withChanges([outdoor], [{ op: "qty", lineId: "od", qty: 2 }], price, null)![0]!.qty).toBe(2);
  });
});

describe("a tapped answer", () => {
  const events = [{ id: 5, turnId: "t1", kind: "question" as const, author: "tiff", at: "", body: phase as unknown as Record<string, unknown> }];
  beforeEach(() => {
    readSession.mockResolvedValue({ id: "s1", turnId: null });
    readLines.mockResolvedValue([outdoor, iso]);
    changeLine.mockClear();
    removeLine.mockClear();
    addEvents.mockClear();
  });

  it("makes its changes as the person, saying what they answered, and goes in the thread", async () => {
    expect(await answerQuestion("org", "job", "u-isaac", 5, 1, events)).toEqual({ ok: true, goOn: false });
    const why = "“Three phase”, to “Single or three phase at the board?”";
    /* a unit swapped is named by what it is (Isaac, 2026-10-15) */
    expect(changeLine).toHaveBeenCalledWith("org", "job", "od", 1, expect.objectContaining({ name: "Outdoor unit", code: "PUZ-ZM125YKA2", costCents: 340000, source: "said" }), "u-isaac", why);
    expect(removeLine).toHaveBeenCalledWith("org", "job", "iso", 1, "u-isaac", why);
    expect(addEvents).toHaveBeenCalledWith("org", "s1", null, [{ kind: "message", author: "u-isaac", body: { text: "Three phase", answered: 5, index: 1, question: phase.question } }]);
  });

  /* Isaac's production test, 2026-10-12: "Research them on the web" sat
     until he typed */
  it("says when it leaves her work to do, as she marked it when she asked", async () => {
    const research = { question: "Look these prices up on the web?", why: "", answers: [{ label: "Research them on the web", changes: [], goOn: true }, { label: "I'll give allowances", changes: [] }] };
    const asked = [{ id: 7, turnId: "t1", kind: "question" as const, author: "tiff", at: "", body: research as unknown as Record<string, unknown> }];
    expect(await answerQuestion("org", "job", "u", 7, 0, asked)).toEqual({ ok: true, goOn: true });
    expect(await answerQuestion("org", "job", "u", 7, 1, asked)).toEqual({ ok: true, goOn: false });
  });

  it("waits while Tiff is working, and is answered once", async () => {
    readSession.mockResolvedValue({ id: "s1", turnId: "t2" });
    expect(await answerQuestion("org", "job", "u", 5, 1, events)).toMatchObject({ ok: false, reason: expect.stringMatching(/once she's done/) });
    readSession.mockResolvedValue({ id: "s1", turnId: null });
    const answered = [...events, { id: 6, turnId: null, kind: "message" as const, author: "u", at: "", body: { text: "Single phase", answered: 5, index: 0 } }];
    expect(await answerQuestion("org", "job", "u", 5, 1, answered)).toEqual({ ok: false, reason: "That question has been answered." });
    expect(answeredOf(answered).get(5)).toMatchObject({ index: 0, label: "Single phase", by: "u" });
  });
});

/* Isaac, 2026-10-11: "however I gave you the answers I should be able to do the same" */
describe("answered in the person's own words", () => {
  const ev = (id: number, kind: string, author: string, body: Record<string, unknown>) => ({ id, kind, author, at: `t${id}`, body });
  const thread = [
    ev(1, "message", "u1", { text: "Quote 3343" }),
    ev(2, "question", "tiff", { question: "How long is the pipe run?", put: "10 m", topic: "Pipe run" }),
    ev(3, "question", "tiff", { question: "Does it need cover?", answers: [{ label: "No cover" }] }),
    ev(4, "question", "tiff", { question: "How far is the board?", put: "15 m" }),
    ev(5, "message", "u1", { text: "No cover", answered: 3, index: 0, question: "Does it need cover?" }),
    ev(6, "message", "u1", { text: "Pipe run is 14 m" }),
    ev(7, "tool", "tiff", { name: "settle", ok: true, detail: { settled: [{ question: 2, answer: "14 m" }] } }),
  ];

  it("counts a question she settled from their words as answered, beside one tapped", () => {
    const a = answeredOf(thread);
    expect(a.get(2)).toMatchObject({ label: "14 m", typed: true });
    expect(a.get(3)).toMatchObject({ label: "No cover", index: 0 });
    expect(a.has(4)).toBe(false);
  });

  it("leaves open only what neither answered, with what the quote has", () => {
    expect(openQuestionsOf(thread)).toEqual([{ id: 4, question: "How far is the board?", put: "15 m" }]);
  });

  it("knows her latest asking, so the list numbers it as her message did", () => {
    expect(latestAsked(thread)).toEqual([2, 3, 4]);
    expect(latestAsked([...thread, ev(8, "message", "u1", { text: "Add a controller" }), ev(9, "question", "tiff", { question: "Wired or Wi-Fi?" })])).toEqual([9]);
    expect(latestAsked([ev(1, "message", "u1", { text: "hi" })])).toEqual([]);
  });
});

/* Isaac, 14 November 2026: B, "is it free text?" */
describe("a typed number, straight onto its line", () => {
  const cable = "How many metres of power cable to the new outdoor?";
  const trunk = "How many metres of trunking down to the outdoor unit?";
  const asked = [
    { id: 30, kind: "question" as const, author: "tiff", at: "", turnId: "t1", body: { question: cable, put: "10 m", answers: [], fills: { lineId: "cab", times: 1, each: null, was: 10 } } },
    { id: 31, kind: "question" as const, author: "tiff", at: "", turnId: "t1", body: { question: trunk, put: "4.8 m (2 lengths)", answers: [], fills: { lineId: "trk", times: 1, each: 2.4, was: 2 } } },
  ];
  const cab = line({ id: "cab", version: 3, name: "TPS 2.5 mm cable", unit: "m", qty: 10 });
  const trk = line({ id: "trk", version: 1, name: "Trunking, Dune", qty: 2 });

  it("reads a number alone, with a unit if they like, and nothing more", () => {
    expect(["15", "15m", "15 m", "2 lengths", "1.5"].map(plainNumber)).toEqual([15, 15, 15, 2, 1.5]);
    expect(["5m a head", "about 15", "10-15", "", "fifteen"].map(plainNumber)).toEqual([null, null, null, null, null]);
  });

  it("makes the line's quantity from it, by the line's own unit", () => {
    expect(filledQty({ lineId: "c", times: 1, each: null, was: null }, 15)).toBe(15);
    expect(filledQty({ lineId: "d", times: 2, each: null, was: null }, 5)).toBe(10);
    expect(filledQty({ lineId: "t", times: 1, each: 2.4, was: null }, 1)).toBe(1);
    expect(filledQty({ lineId: "t", times: 1, each: 2.4, was: null }, 4.8)).toBe(2);
    expect(filledQty({ lineId: "t", times: 1, each: 2.4, was: null }, 5)).toBe(3);
  });

  it("knows the question by its words before the answer, or the one open when there's one", () => {
    const open = asked.map((e) => ({ id: e.id, question: e.body.question, fills: e.body.fills }));
    expect(typedFill(`${trunk} 1`, open)).toEqual({ id: 31, n: 1, text: "1" });
    expect(typedFill(`${trunk} 1 m, but check the route`, open)).toBeNull();
    expect(typedFill("15", open)).toBeNull();
    expect(typedFill("15 m", open.slice(0, 1))).toEqual({ id: 30, n: 15, text: "15 m" });
    expect(typedFill("15", [{ id: 9, question: "Which wall?" }])).toBeNull();
  });

  it("changes the line as the person, ticks the question, and says how many are left", async () => {
    readSession.mockResolvedValue({ id: "s1", turnId: null });
    readLines.mockResolvedValue([cab, trk]);
    changeLine.mockClear();
    addEvents.mockClear();
    expect(await answerTyped("org", "job", "u-isaac", `${cable} 15`, asked)).toEqual({ ok: true, left: 1 });
    expect(changeLine).toHaveBeenCalledWith("org", "job", "cab", 3, { qty: 15, source: "said" }, "u-isaac", `“15”, to “${cable}”`);
    expect(addEvents).toHaveBeenCalledWith("org", "s1", null, [
      { kind: "message", author: "u-isaac", body: { text: "15", answered: 30, index: -1, question: cable, typed: true, landed: "TPS 2.5 mm cable: 15 m", had: "10 m" } },
    ]);
    const after = [...asked, { id: 32, kind: "message" as const, author: "u-isaac", at: "", turnId: null, body: { text: "15", answered: 30, index: -1, typed: true } }];
    expect(answeredOf(after).get(30)).toMatchObject({ label: "15", typed: true });
  });

  it("leaves it to her when they say more, when she's working, or when the line has moved since she asked", async () => {
    readLines.mockResolvedValue([cab, trk]);
    readSession.mockResolvedValue({ id: "s1", turnId: null });
    expect(await answerTyped("org", "job", "u", `${trunk} about 3`, asked)).toBeNull();
    readSession.mockResolvedValue({ id: "s1", turnId: "t2" });
    expect(await answerTyped("org", "job", "u", `${trunk} 3`, asked)).toBeNull();
    readSession.mockResolvedValue({ id: "s1", turnId: null });
    readLines.mockResolvedValue([cab, { ...trk, qty: 4 }]);
    expect(await answerTyped("org", "job", "u", `${trunk} 3`, asked)).toBeNull();
  });
});
