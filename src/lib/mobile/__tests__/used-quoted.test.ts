/* Bug 109 (Isaac, 26 November 2026: "Isn't show suggested items from
   quote"): the day's list offers the parts of the quote option the client
   took. The quote below is shaped like the job's: option 1 a multi-head
   install, option 2 a leak repair, taken in ServiceM8 only. */

import { quotedItems, takenOptions, type QuoteLinePart } from "../used-quoted";

const line = (optionIndex: number, kind: QuoteLinePart["kind"], name: string, code: string | null, qty: number, unit: QuoteLinePart["unit"] = "", supplierKey: string | null = "ardent"): QuoteLinePart => ({
  optionIndex,
  kind,
  name,
  code,
  qty,
  unit,
  supplierKey,
});

const quote: QuoteLinePart[] = [
  line(0, "unit", "Outdoor unit", "MXZ-2F52VGD-A2", 1),
  line(0, "unit", "Indoor unit, Living", "MSZ-AP42VGKD2-A2", 1),
  line(0, "material", 'ARDENT PR CU 1/4" X 3/8" R410A 20M (COIL)', "9800005-1", 30, "m"),
  line(0, "material", "Consumables", null, 1),
  line(0, "labour", "Install: 3 people, 1 day", null, 24, "h", null),
  line(1, "material", "PRIME REFRIGERANT R410A (HFC) 10KG (EA)", "2800109-1", 0.2),
  line(1, "labour", "Diagnose, repair and recommission", null, 5, "h", null),
  line(1, "material", "PRIME NITROGEN DRY D SIZE (EA)", "2800074-1", 1),
];
const both = [0, 1];

describe("which option the client took", () => {
  test("HeyTiff's own accepted mark comes first", () => {
    expect(takenOptions({ accepted: [0], options: both, sm8: [{ name: "Option 2", active: 1 }, { name: "Option 1", active: 0 }], workDone: null })).toEqual([0]);
  });

  test("ServiceM8's job: the Option lines left once the others are taken off", () => {
    expect(takenOptions({ accepted: [], options: both, sm8: [{ name: "Option 1", active: 0 }, { name: "Option 2", active: 1 }], workDone: null })).toEqual([1]);
    expect(takenOptions({ accepted: [], options: both, sm8: [{ name: "Option 1: Multi split, as per quote", active: 0 }, { name: "Option 2: Repair, as per quote", active: 1 }], workDone: null })).toEqual([1]);
  });

  test("every Option line still on the job isn't a choice; the work done can say it", () => {
    const sm8 = [
      { name: "Option 1", active: 1 },
      { name: "Option 2", active: 1 },
    ];
    expect(takenOptions({ accepted: [], options: both, sm8, workDone: null })).toBeNull();
    expect(takenOptions({ accepted: [], options: both, sm8, workDone: "Option 2:\n - Existing water-cooled system\n- Diagnose and locate the leak" })).toEqual([1]);
  });

  test("an option the quote doesn't have is no answer; one option is the one taken", () => {
    expect(takenOptions({ accepted: [5], options: both, sm8: [], workDone: "Option 7: something" })).toBeNull();
    expect(takenOptions({ accepted: [], options: [0], sm8: [], workDone: null })).toEqual([0]);
  });
});

describe("the parts offered", () => {
  test("the option taken: its parts at the quoted amount, no labour", () => {
    expect(quotedItems(quote, [1], new Set())).toEqual([
      { key: "ardent|2800109-1", supplierKey: "ardent", code: "2800109-1", name: "PRIME REFRIGERANT R410A (HFC) 10KG (EA)", qty: 0.2, unit: null, options: [] },
      { key: "ardent|2800074-1", supplierKey: "ardent", code: "2800074-1", name: "PRIME NITROGEN DRY D SIZE (EA)", qty: 1, unit: null, options: [] },
    ]);
  });

  test("a unit carries its model; a line with no code is an allowance, not a part; metres stay metres", () => {
    const items = quotedItems(quote, [0], new Set());
    expect(items.map((i) => i.name)).toEqual(["Outdoor unit MXZ-2F52VGD-A2", "Indoor unit, Living MSZ-AP42VGKD2-A2", 'ARDENT PR CU 1/4" X 3/8" R410A 20M (COIL)']);
    expect(items[2]).toMatchObject({ qty: 30, unit: "m" });
  });

  test("what's on the list already isn't offered again", () => {
    expect(quotedItems(quote, [1], new Set(["ardent|2800109-1"])).map((i) => i.code)).toEqual(["2800074-1"]);
  });

  test("not known which was taken: every option's parts, each with its options", () => {
    const items = quotedItems([...quote, line(1, "material", 'ARDENT PR CU 1/4" X 3/8" R410A 20M (COIL)', "9800005-1", 5, "m")], null, new Set());
    expect(items.map((i) => [i.code, i.qty, i.options])).toEqual([
      ["MXZ-2F52VGD-A2", 1, [0]],
      ["MSZ-AP42VGKD2-A2", 1, [0]],
      ["9800005-1", 30, [0, 1]],
      ["2800109-1", 0.2, [1]],
      ["2800074-1", 1, [1]],
    ]);
  });

  test("the same part twice in one option is one offer of both", () => {
    const items = quotedItems([line(0, "material", "Drain hose", "9502294-2", 10, "m"), line(0, "material", "Drain hose", "9502294-2", 5, "m")], [0], new Set());
    expect(items).toEqual([expect.objectContaining({ code: "9502294-2", qty: 15, unit: "m" })]);
  });
});
