/**
 * @jest-environment node
 */
/* Tiff's hands on a quote (slice 4.2): what she gives is made safe, every
   line says where it came from, and nothing is priced but from the book. */
jest.mock("server-only", () => ({}));
const lines: Record<string, unknown>[] = [];
const addLine = jest.fn(async (_o: string, _j: string, row: Record<string, unknown>, _by?: string) => {
  lines.push(row);
  return { ok: true, line: { id: `l${lines.length}`, name: row.name, version: 1 } };
});
const changeLine = jest.fn(async () => ({ ok: true, line: { id: "l1", name: "x", version: 2 } }));
jest.mock("../../lines-server", () => ({
  addLine: (...a: unknown[]) => addLine(...(a as [string, string, Record<string, unknown>, string])),
  changeLine: (...a: unknown[]) => (changeLine as jest.Mock)(...a),
  copyOption: jest.fn(),
  readLines: jest.fn(async () => [{ id: "l1", unit: "m", optionIndex: 0 }]),
  removeLine: jest.fn(),
}));
jest.mock("../../kits-server", () => ({ addKit: jest.fn() }));
jest.mock("../../lookups-server", () => ({ lookupUnit: jest.fn() }));
jest.mock("../../quote-price-server", () => ({ readQuotePrice: jest.fn() }));
jest.mock("../../settings-query", () => ({ readQuoteSettings: jest.fn(async () => ({ profitTargetPct: 20, labourCostCents: null })) }));
jest.mock("../../org-day-server", () => ({ readOrgDay: jest.fn(async () => ({ rate: { perHourCents: 14000, from: "quoting" }, hours: { hours: 8, from: "quoting" }, dayCents: 112000 })) }));

const offer = (code: string, cents: number, supplierKey = "aad", name = code) => ({ supplierKey, supplierName: supplierKey.toUpperCase(), code, name, netCents: cents });
const product = (name: string, offers: ReturnType<typeof offer>[], o: Record<string, unknown> = {}) => ({
  key: `${offers[0]!.supplierKey}|${offers[0]!.code}`,
  name,
  category: "parts",
  offers,
  cheapest: offers[0],
  preferred: null,
  brand: null,
  quotes: 0,
  ...o,
});
const BOOK = [
  product("PAIRED COIL 1/4+1/2X20M", [offer("PC1412", 19100, "aad", "PAIRED COIL 1/4+1/2X20M")]),
  product("ISOLATOR 20A", [offer("ISO20", 2279, "reece", "ISOLATOR 20A"), offer("ISO20", 2400, "aad", "ISOLATOR 20A")]),
  product("MSZ-AP35VGKD2 indoor", [offer("MSZ-AP35VGKD2", 28376)], { category: "units" }),
  product("FEET", [offer("CMADJ", 1372, "aad"), offer("CMADJ", 1290, "go")], { preferred: offer("CMADJ", 1372, "aad") }),
];
jest.mock("../../book-view-server", () => ({ bookProducts: jest.fn(async () => BOOK) }));

import { bookPrice, isErr, newLineOf, patchOf, questionOf } from "../tools";
import { sessionTools } from "../tools-server";

beforeEach(() => {
  lines.length = 0;
  addLine.mockClear();
  changeLine.mockClear();
});

describe("what she gives, made safe", () => {
  it("a line says where it came from, and why", () => {
    expect(newLineOf({ name: "Isolator", group: "Pipe", kind: "material", qty: 1, source: "assumed" })).toEqual({ error: "Isolator: say why in why." });
    expect(newLineOf({ name: "Isolator", group: "Pipe", qty: 1, source: "by_hand", why: "x" })).toEqual({ error: "Isolator: say where it came from: said, assumed, unknown or fitted." });
    expect(newLineOf({ name: "Core hole", group: "Core holes", qty: 1, source: "unknown" })).toMatchObject({ source: "unknown", why: "" });
    expect(newLineOf({ name: "Install", group: "Labour", kind: "labour", code: "X", qty: 8, unit: "", source: "assumed", why: "a day" })).toMatchObject({ code: null, unit: "h" });
    expect(newLineOf({ name: "x", group: "y", option: 99, qty: -3, source: "said", why: "w" })).toMatchObject({ optionIndex: 19, qty: 0 });
  });

  it("a change names its line and version, and why", () => {
    expect(isErr(patchOf({ id: "l1", source: "assumed", why: "w" }))).toBe(true);
    expect(patchOf({ id: "l1", version: 2, qty: "12", source: "said", why: "“12 m”", price: 5 })).toEqual({ id: "l1", version: 2, patch: { qty: 12, source: "said", why: "“12 m”" } });
  });

  it("a question keeps up to five answers, each with the changes it can make", () => {
    const q = questionOf({
      question: "Single or three phase?",
      answers: [
        { label: "Single", changes: [] },
        { label: "Three", changes: [{ op: "swap", line_id: "l1", code: "PUZ-ZM125YKA2" }, { op: "explode" }, { op: "qty", line_id: "l2" }] },
      ],
    });
    expect(q).toEqual({ question: "Single or three phase?", why: "", answers: [{ label: "Single", changes: [] }, { label: "Three", changes: [{ op: "swap", lineId: "l1", code: "PUZ-ZM125YKA2" }] }] });
  });
});

describe("a price from the book, never from her", () => {
  it("is the preferred offer of the code, else the lowest, by the metre off a roll", () => {
    expect(bookPrice(BOOK as never, "cmadj", "")).toMatchObject({ supplierKey: "aad", costCents: 1372 });
    expect(bookPrice(BOOK as never, "ISO20", "")).toMatchObject({ supplierKey: "reece", costCents: 2279 });
    expect(bookPrice(BOOK as never, "PC1412", "m")).toMatchObject({ costCents: 955, name: "PAIRED COIL 1/4+1/2X20M" });
    expect(bookPrice(BOOK as never, "MSZ-AP35VGKD2", "")).toMatchObject({ kind: "unit" });
    expect(bookPrice(BOOK as never, "NOPE", "")).toBeNull();
  });
});

describe("her tools, run", () => {
  const run = sessionTools("org-1", "job-1");

  it("adds book items at the book's price, labour at the hour, and refuses a code the book hasn't got", async () => {
    const out = await run("add_lines", {
      lines: [
        { option: 0, system: "Living", group: "Pipe, power and controls", name: "pipe", code: "PC1412", kind: "material", qty: 6, unit: "m", source: "assumed", why: "6 m run" },
        { option: 0, group: "Labour", name: "Install: 2 people", kind: "labour", qty: 16, source: "said", why: "“two of us for a day”", costCents: 1 },
        { option: 0, group: "Units", name: "Made up", code: "FAKE-1", kind: "unit", qty: 1, source: "said", why: "x" },
        { option: 0, group: "Core holes", name: "Core hole through sandstone", kind: "material", qty: 1, source: "said", why: "“thick sandstone”" },
      ],
    });
    expect(out.ok).toBe(true);
    expect(lines.map((l) => [l.name, l.code ?? null, l.costCents, l.source])).toEqual([
      ["PAIRED COIL 1/4+1/2X20M", "PC1412", 955, "assumed"],
      ["Install: 2 people", null, 11200, "said"],
      ["Core hole through sandstone", null, 0, "unknown"],
    ]);
    expect(addLine.mock.calls.every((c) => c[3] === "tiff")).toBe(true);
    expect(out.ok && (out.value as { refused: string[] }).refused).toEqual(["Made up: FAKE-1 isn't in the business's book. Search the book for what it buys, or add it with no code as not known yet."]);
  });

  it("swaps a line's item at the book's price, never one she names", async () => {
    await run("change_line", { id: "l1", version: 1, code: "PC1412", source: "fitted", why: "the unit's 1/4 + 1/2" });
    expect(changeLine).toHaveBeenCalledWith("org-1", "job-1", "l1", 1, expect.objectContaining({ code: "PC1412", costCents: 955, sellCents: null, source: "fitted" }), "tiff", "the unit's 1/4 + 1/2");
    const refused = await run("change_line", { id: "l1", version: 1, code: "FAKE", source: "fitted", why: "w" });
    expect(refused).toMatchObject({ ok: false });
  });

  it("searches the book and says what it found", async () => {
    const out = await run("search_book", { text: "isolator" });
    expect(out).toMatchObject({ ok: true, said: "isolator: 1 found" });
    expect(out.ok && (out.value as { code: string }[])[0]).toMatchObject({ code: "ISO20", cost_each_cents: 2279 });
  });

  it("puts a question in the thread with its answers", async () => {
    const out = await run("ask", { question: "Which wall?", answers: [{ label: "North" }] });
    expect(out).toMatchObject({ ok: true, event: { kind: "question", body: { question: "Which wall?" } } });
  });

  it("says so for a tool that doesn't exist", async () => {
    expect(await run("drop_table", {})).toMatchObject({ ok: false, error: "There's no tool called drop_table." });
  });
});
