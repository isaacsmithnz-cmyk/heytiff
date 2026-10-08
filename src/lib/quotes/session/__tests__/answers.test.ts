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
  }),
}));

import type { QuoteLine } from "../../lines";
import { answerDeltas, answeredOf, withChanges } from "../answers";
import { answerQuestion } from "../answers-server";
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
    expect(answerDeltas(phase, [outdoor, iso], price, 11200, settings)).toEqual([0, 50000 - 3304, null]);
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
    expect(await answerQuestion("org", "job", "u-isaac", 5, 1, events)).toEqual({ ok: true });
    const why = "“Three phase”, to “Single or three phase at the board?”";
    expect(changeLine).toHaveBeenCalledWith("org", "job", "od", 1, expect.objectContaining({ code: "PUZ-ZM125YKA2", costCents: 340000, source: "said" }), "u-isaac", why);
    expect(removeLine).toHaveBeenCalledWith("org", "job", "iso", 1, "u-isaac", why);
    expect(addEvents).toHaveBeenCalledWith("org", "s1", null, [{ kind: "message", author: "u-isaac", body: { text: "Three phase", answered: 5, index: 1, question: phase.question } }]);
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
