/**
 * @jest-environment node
 */
import { openQuestions, phoneQuoteOf, phoneTurns, scopeOf, wordOf, type LinesView, type Thread } from "../phone-quote";
import type { QuoteLine } from "@/lib/quotes/lines";
import type { QuotePrice } from "@/lib/quotes/quote-price-server";

/* The phone's quote says what the web's figures say, with no buy price on it. */

const line = (over: Partial<QuoteLine>): QuoteLine =>
  ({ id: "l1", version: 1, updatedAt: "2026-11-01", updatedBy: "u", optionIndex: 0, system: "", group: "Units", position: 0, name: "Outdoor", code: "MUZ", supplierKey: null, kind: "unit", qty: 1, unit: "", costCents: 80000, sellCents: null, source: "said", why: "", duct: false, ...over }) as QuoteLine;

const view = (over: Partial<LinesView> = {}): LinesView => ({ money: true, lines: [line({})], accepted: [], optionNames: ["Unit 2"], sent: null, proposal: null, approved: false, ...over });

const build = { groups: [{ name: "Units", buyCents: 80000, sellCents: 100000, lines: [{ key: "l1", kind: "unit", name: "Outdoor", sellCents: 100000, buyCents: 80000 }] }], contingency: null, loading: null, labour: { personDays: 1, hours: 8, sellCents: 112000, visits: [] }, buyCents: 80000, exGstCents: 212000, gstCents: 21200, incGstCents: 233200 };
const price = { ok: true, chargeOutCents: 14000, options: [{ name: "Unit 2", build, unpriced: [], rows: 1, labourFrom: "you", profit: { profitCents: 60000, pct: 28.3 } }] } as unknown as QuotePrice;

const ev = (id: number, kind: string, body: Record<string, unknown>, author = "tiff"): Thread => ({ id, turnId: "t", kind, author, body, at: "2026-11-02T04:00:00Z" });

test("the figures are the web's, and a buy price never crosses", () => {
  const q = phoneQuoteOf(view(), price, [], 0, false, {});
  expect(q.options[0]).toMatchObject({ title: "Unit 2", exCents: 212000, unitsCents: 100000, materialsCents: 0, labourCents: 112000, hours: 8 });
  expect(q.options[0]!.groups[0]).toMatchObject({ name: "Units", cents: 100000, lines: [{ name: "Outdoor", cents: 100000 }] });
  expect(JSON.stringify(q)).not.toContain("buyCents");
  expect(JSON.stringify(q)).not.toContain("costCents");
  expect(q.ready).toBe(true);
});

test("without money access there is no figure, and nothing can be marked ready", () => {
  const q = phoneQuoteOf(view({ money: false }), null, [], 0, false, {});
  expect(q.options[0]).toMatchObject({ exCents: null, profitCents: null });
  expect(q.options[0]!.groups[0]!.lines[0]!.cents).toBeNull();
  expect(q.ready).toBe(false);
});

test("an option with only its number has no title of its own", () => {
  const q = phoneQuoteOf(view({ optionNames: ["Option 1"] }), null, [], 0, false, {});
  expect(q.options[0]!.title).toBe("");
});

test("Mark ready to send waits on her questions, and says so", () => {
  const q = phoneQuoteOf(view(), price, [], 2, false, {});
  expect(q.ready).toBe(false);
  expect(q.why).toBe("2 questions to answer");
  expect(q.state).toEqual({ word: "2 to answer", tone: "look" });
});

test("a line she assumed is one to check", () => {
  const q = phoneQuoteOf(view({ lines: [line({ kind: "material", source: "assumed", why: "run not given" })] }), price, [], 0, false, {});
  expect(q.options[0]!.groups[0]!.lines[0]).toMatchObject({ check: true, second: "run not given" });
  expect(q.scope.check).toEqual(["Outdoor: run not given"]);
});

test("her latest write-up says the scope, over what the lines assumed", () => {
  const up = (toCheck: string) => ev(1, "tool", { name: "write_up", detail: { writeUp: { to_check: [{ what: "Drain", said: toCheck }], priced_on: [{ what: "", said: "2 people, 6 hours each" }] } } });
  const s = scopeOf([up("old"), up("3 m")], [line({ source: "assumed" })], ["Switchboard"]);
  expect(s).toEqual({ check: ["Drain: 3 m"], pricedOn: ["2 people, 6 hours each"], notIncluded: ["Switchboard"] });
});

test("the card says where it's up to, furthest first", () => {
  const q = { working: false, accepted: false, sent: false, approved: false, asked: 0, toPrice: 0, money: true, lines: 3 };
  expect(wordOf(q)).toEqual({ word: "Priced", tone: "info" });
  expect(wordOf({ ...q, approved: true })).toEqual({ word: "Ready to send", tone: "good" });
  expect(wordOf({ ...q, approved: true, sent: true })).toEqual({ word: "Sent", tone: "info" });
  expect(wordOf({ ...q, approved: true, sent: true, accepted: true })).toEqual({ word: "Customer accepted", tone: "good" });
  expect(wordOf({ ...q, working: true })).toEqual({ word: "Building", tone: "info" });
  expect(wordOf({ ...q, lines: 0 })).toBeNull();
});

test("the conversation reads as yours, hers and what was marked, without her working lines", () => {
  const turns = phoneTurns(
    [
      ev(1, "message", { text: "350 ex in this case" }, "me"),
      ev(2, "reply", { text: "Thinking", working: true }),
      ev(3, "tool", { name: "add_lines" }),
      ev(4, "reply", { text: "Removal is **$350** ex." }),
      ev(5, "milestone", { text: "Proposal approved" }, "sam"),
    ],
    { sam: "Sam" },
    "me",
  );
  expect(turns.map((t) => [t.side, t.text])).toEqual([
    ["me", "350 ex in this case"],
    ["tiff", "Removal is $350 ex."],
    ["mark", "Proposal approved by Sam"],
  ]);
});

test("an open question carries its answers' prices; one the book can't make can't be tapped; an answered one is gone", () => {
  const ask = (id: number) => ev(id, "question", { question: "How long is the run?", why: "It's priced at 3 m", answers: [{ label: "3 m is right", changes: [] }, { label: "5 m", changes: [] }] });
  const q = openQuestions([ask(1), ask(2)], { 1: { deltas: [0, null], answered: null }, 2: { deltas: [], answered: { index: 0 } } });
  expect(q).toEqual([
    {
      id: 1,
      question: "How long is the run?",
      put: "",
      answers: [
        { label: "3 m is right", delta: 0, can: true },
        { label: "5 m", delta: null, can: false },
      ],
    },
  ]);
});

const pad = (id: number) => ev(id, "question", { question: "Pad or brackets?", put: "Rubber feet", answers: [{ label: "Pad only", changes: [] }, { label: "Brackets", changes: [] }] });
const crew = (id: number) => ev(id, "question", { question: "What crew?", answers: [] });

test("a unit's line says the model she picked, not the words she took it from", () => {
  const q = phoneQuoteOf(view({ lines: [line({ name: "Indoor unit, Study", code: "MSZ-AP35VGKD2-A2", why: '"high wall three point five kilowatt"' })] }), price, [], 0, false, {});
  expect(q.options[0]!.groups[0]!.lines[0]).toMatchObject({ name: "Indoor unit, Study", second: "MSZ-AP35VGKD2-A2", model: true });
});

test("a unit with no model yet says why, and isn't called a model", () => {
  const q = phoneQuoteOf(view({ lines: [line({ code: null, source: "unknown", why: "brand to choose" })] }), price, [], 0, false, {});
  expect(q.options[0]!.groups[0]!.lines[0]).toMatchObject({ second: "brand to choose", model: false });
});

test("a labour line worked out task by task carries its tasks", () => {
  const visit = { stage: "Install", people: 3, tasks: [{ task: "Drain 2 runs to gutter", hours: 1.5, byHand: false, was: null }] };
  const q = phoneQuoteOf(view({ lines: [line({ kind: "labour", code: null, name: "Install: 3 people, 1 day", why: "Worked out task by task", visit } as Partial<QuoteLine>)] }), price, [], 0, false, {});
  expect(q.options[0]!.groups[0]!.lines[0]).toMatchObject({ second: "", tasks: [{ task: "Drain 2 runs to gutter", hours: 1.5 }] });
});

test("an answer tapped is your words, under her question", () => {
  const turns = phoneTurns([pad(1), ev(2, "reply", { text: "Built." }), ev(3, "message", { text: "Pad only", answered: 1, index: 0, question: "Pad or brackets?" }, "me")], {}, "me");
  expect(turns.at(-1)).toMatchObject({ side: "me", text: "Pad only", to: { event: 1, question: "Pad or brackets?", answers: ["Pad only", "Brackets"] } });
});

test("an answer in your own words comes apart from the question sent with it", () => {
  const turns = phoneTurns([crew(1), ev(2, "reply", { text: "Built." }), ev(3, "message", { text: "What crew? Three guys" }, "me")], {}, "me");
  expect(turns.at(-1)).toMatchObject({ side: "me", text: "Three guys", to: { event: 1, question: "What crew?" } });
});

test("her closing list of open questions goes, the chat asks them; a list that isn't them stays", () => {
  const said = (text: string, ...asks: Thread[]) => phoneTurns([...asks, ev(9, "reply", { text })], {}, "me")[0]!.text;
  expect(said("Built.\n\nQuestions still open:\n1. Pad or brackets?\n2. What crew?", pad(1), crew(2))).toBe("Built.");
  expect(said("Built.\n1. Pad or brackets?\n2. What crew?", pad(1))).toContain("1. Pad");
  expect(said("Steps:\n1. Rough in\n2. Install")).toContain("1. Rough in");
});

test("a question she settled from words that came without it follows what she said, once", () => {
  const settle = ev(4, "tool", { name: "settle", detail: { settled: [{ question: 1, answer: "3 guys" }] } });
  const turns = phoneTurns([crew(1), ev(2, "reply", { text: "Built." }), ev(3, "message", { text: "Three guys" }, "me"), settle, ev(5, "reply", { text: "Done." })], {}, "me");
  expect(turns.map((t) => t.text)).toEqual(["Built.", "What crew?", "Three guys", "Done."]);
});
