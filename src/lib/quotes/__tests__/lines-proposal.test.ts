import { approvalStands, areasOf, areasText, listOf, listText, proposalOf, stageAmounts } from "../lines-proposal";

/* The words of a proposal for a quote built on its lines (slice 7.1): kept
   clean whatever arrives, typed as a person types them, and an approval that
   stands only until something changes. */

describe("a proposal as kept", () => {
  it("starts empty, choose one, small-job payment", () => {
    const p = proposalOf(null);
    expect(p).toMatchObject({ title: "", intro: "", options: [], notIncluded: [], choice: "one", notes: [], approvedAt: null });
    expect(p.payment.preset).toBe("domestic_small");
    expect(p.payment.stages.map((s) => s.percent)).toEqual([10, 90]);
  });

  it("keeps what's well made and drops the rest", () => {
    const p = proposalOf({
      title: "  Ducted for 12 Smith St ",
      options: [{ summary: "Three zones.", areas: [{ name: "Roof", items: ["Run the duct", 4, ""] }, { name: "", items: [] }], included: ["Commissioning"] }],
      notIncluded: ["Electrical upgrade", null],
      choice: "any",
      payment: { preset: "domestic_construction", stages: [{ when: "Deposit", percent: 15 }, { when: "", percent: 5 }, { when: "Balance", percent: 120 }] },
      notes: ["access", "Bad Key!", 3],
    });
    expect(p.title).toBe("Ducted for 12 Smith St");
    expect(p.options[0]).toEqual({ summary: "Three zones.", areas: [{ name: "Roof", items: ["Run the duct"] }], included: ["Commissioning"] });
    expect(p.notIncluded).toEqual(["Electrical upgrade"]);
    expect(p.choice).toBe("any");
    expect(p.payment).toEqual({ preset: "domestic_construction", stages: [{ when: "Deposit", percent: 15 }, { when: "Balance", percent: null }] });
    expect(p.notes).toEqual(["access"]);
  });

  it("an unknown preset is the small job's", () => {
    expect(proposalOf({ payment: { preset: "weekly" } }).payment.preset).toBe("domestic_small");
  });
});

describe("the words as a person types them", () => {
  it("a list, one a line, bullets or numbers in front or not", () => {
    expect(listOf("- Commissioning\n• Removal of the old unit\n\n2. Warranty  forms\nTesting")).toEqual(["Commissioning", "Removal of the old unit", "Warranty forms", "Testing"]);
    expect(listOf(listText(["A", "B"]))).toEqual(["A", "B"]);
  });

  it("the work by area: a name ending in a colon, its items under it", () => {
    const typed = "Run a cable\nRoof:\n- Duct to each room\n- Return air\n\nBedroom 2:\n- Outlet in the ceiling";
    const areas = areasOf(typed);
    expect(areas).toEqual([
      { name: "", items: ["Run a cable"] },
      { name: "Roof", items: ["Duct to each room", "Return air"] },
      { name: "Bedroom 2", items: ["Outlet in the ceiling"] },
    ]);
    expect(areasOf(areasText(areas))).toEqual(areas);
  });

  it("a bullet ending in a colon is an item, not a name", () => {
    expect(areasOf("Roof:\n- Note:")).toEqual([{ name: "Roof", items: ["Note:"] }]);
  });
});

describe("an approval", () => {
  const p = { updatedAt: "2026-10-08T01:00:00Z", approvedAt: "2026-10-08T02:00:00Z" };
  it("stands after the words and every line last changed", () => {
    expect(approvalStands(p, ["2026-10-08T00:30:00Z"])).toBe(true);
  });
  it("is taken back by a line changed after it", () => {
    expect(approvalStands(p, ["2026-10-08T03:00:00Z"])).toBe(false);
  });
  it("is taken back by the words changed after it", () => {
    expect(approvalStands({ ...p, updatedAt: "2026-10-08T02:30:00Z" }, [])).toBe(false);
  });
  it("never given, never stands", () => {
    expect(approvalStands({ updatedAt: "", approvedAt: null }, [])).toBe(false);
  });
});

it("each payment stage's amount, none for a claim with no fixed share", () => {
  expect(stageAmounts([{ when: "Deposit", percent: 10 }, { when: "Balance", percent: 90 }, { when: "Claims", percent: null }], 1_000_005)).toEqual([100_001, 900_005, null]);
});
