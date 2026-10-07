import { againstFirst, applyPatch, diffOf, engineOf, lineFromRow, lineRow, missingFromFirst, normaliseLine, sortLines } from "../lines";

/* The engine rebuild's own record of a quote (slice 2.1): each line a row,
   changed one at a time, every change kept. */

const flex = { optionIndex: 0, system: "Upstairs", group: "Ductwork and grilles", name: "Flex 250, 6 m bag", code: "VB250", supplierKey: "aad", kind: "material", qty: 5, costCents: 3045, source: "assumed", why: "a bag to each outlet", duct: true };

describe("a line, made safe", () => {
  it("keeps what a line is, and where it came from", () => {
    expect(normaliseLine(flex)).toEqual({ ...flex, position: 0, unit: "", sellCents: null });
  });

  it("needs a name and a group", () => {
    expect(normaliseLine({ ...flex, name: " " })).toBeNull();
    expect(normaliseLine({ ...flex, group: "" })).toBeNull();
  });

  it("keeps cable's tenth of a cent, and nothing finer", () => {
    expect(normaliseLine({ ...flex, costCents: 354.04, sellCents: 495.64, unit: "m" })).toMatchObject({ costCents: 354, sellCents: 495.6, unit: "m" });
  });

  it("caps a typo and never goes below nothing", () => {
    expect(normaliseLine({ ...flex, qty: -2, costCents: -5 })).toMatchObject({ qty: 0, costCents: 0 });
    expect(normaliseLine({ ...flex, qty: 1e9, optionIndex: 99 })).toMatchObject({ qty: 100_000, optionIndex: 19 });
  });

  it("an allowance has no supplier without a code", () => {
    expect(normaliseLine({ ...flex, code: "", supplierKey: "aad" })).toMatchObject({ code: null, supplierKey: null });
  });

  it("falls back to safe kinds, units and sources", () => {
    expect(normaliseLine({ ...flex, kind: "magic", unit: "km", source: "guess" })).toMatchObject({ kind: "material", unit: "", source: "by_hand" });
  });

  it("reads a stored row back the way it was written", () => {
    const f = normaliseLine(flex)!;
    const row = { id: "l1", version: 3, updated_at: "2026-10-08T00:00:00Z", updated_by: "auth0|isaac", ...lineRow(f), qty: "5", cost_cents: "3045" };
    expect(lineFromRow(row)).toEqual({ ...f, id: "l1", version: 3, updatedAt: "2026-10-08T00:00:00Z", updatedBy: "auth0|isaac" });
    expect(lineFromRow({ ...row, id: undefined })).toBeNull();
  });
});

describe("a change to a line", () => {
  const line = normaliseLine(flex)!;

  it("changes only what it names", () => {
    const r = applyPatch(line, { why: "acoustic flex instead" })!;
    expect(r.changed).toEqual(["why"]);
    expect(r.next).toEqual({ ...line, why: "acoustic flex instead" });
  });

  it("a number a person changes makes the line theirs", () => {
    const r = applyPatch(line, { qty: 6 })!;
    expect(r.next).toMatchObject({ qty: 6, source: "by_hand" });
    expect(r.changed).toEqual(["qty", "source"]);
  });

  it("unless the change says where it came from (Tiff's own)", () => {
    expect(applyPatch(line, { qty: 6, source: "assumed" })!.next.source).toBe("assumed");
  });

  it("a sell price cleared goes back to the markup", () => {
    const set = applyPatch(line, { sellCents: 4500 })!.next;
    expect(set.sellCents).toBe(4500);
    expect(applyPatch(set, { sellCents: "" })!.next.sellCents).toBeNull();
  });

  it("refuses a change that leaves no name", () => {
    expect(applyPatch(line, { name: "" })).toBeNull();
  });

  it("is kept as before and after, the changed fields only", () => {
    expect(diffOf(line, { ...line, qty: 6, source: "by_hand" })).toEqual({ before: { qty: 5, source: "assumed" }, after: { qty: 6, source: "by_hand" } });
  });
});

it("reads option by option, then in order", () => {
  expect(sortLines([{ optionIndex: 1, position: 0 }, { optionIndex: 0, position: 2 }, { optionIndex: 0, position: 1 }])).toEqual([
    { optionIndex: 0, position: 1 },
    { optionIndex: 0, position: 2 },
    { optionIndex: 1, position: 0 },
  ]);
});

it("every quote is on the old engine unless switched", () => {
  expect(engineOf(undefined)).toBe("old");
  expect(engineOf("lines")).toBe("lines");
  expect(engineOf("anything")).toBe("old");
});

describe("an option against option 1 (slice 10.1)", () => {
  const l = (optionIndex: number, code: string | null, name: string, qty: number) => ({ optionIndex, code, name, qty });
  const all = [l(0, "FTXV71WVMA", "Cora 7.1", 1), l(0, "PC1458", "Pair coil", 20), l(0, null, "Drain", 3), l(2, "FTXM95WVMA", "XL 9.5", 1), l(2, "PC3858", "Pair coil", 20), l(2, null, "Drain", 4)];
  it("says what's added and what's changed", () => {
    expect(all.filter((x) => x.optionIndex === 2).map((x) => againstFirst(x, all))).toEqual(["added", "added", "changed"]);
    expect(againstFirst(all[0]!, all)).toBe("same");
  });
  it("and what option 1 has that this one hasn't", () => {
    expect(missingFromFirst(2, all).map((x) => x.name)).toEqual(["Cora 7.1", "Pair coil"]);
    expect(missingFromFirst(0, all)).toEqual([]);
  });
});
