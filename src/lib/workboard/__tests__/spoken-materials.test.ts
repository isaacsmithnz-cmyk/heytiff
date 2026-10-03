import { splitSpokenList } from "../spoken-materials";

describe("a materials list said out loud", () => {
  it("becomes rows: what, and how many", () => {
    expect(splitSpokenList("two pair coils, a 20 amp isolator and 3 m of trunking")).toEqual([
      { name: "Pair coils", qty: "2" },
      { name: "20 amp isolator", qty: "1" },
      { name: "Trunking", qty: "3 m" },
    ]);
  });

  it("reads lengths, rolls and times, and leaves a row with no count as it was said", () => {
    expect(splitSpokenList("Two lengths of trunking. 4 x wall brackets; condensate pump")).toEqual([
      { name: "Trunking", qty: "2 lengths" },
      { name: "Wall brackets", qty: "4" },
      { name: "Condensate pump", qty: "" },
    ]);
  });

  it("drops the joining words and empty bits", () => {
    expect(splitSpokenList("and also 10 metres of 1/4 3/8 pair coil, , plus a drain pump.")).toEqual([
      { name: "1/4 3/8 pair coil", qty: "10 m" },
      { name: "Drain pump", qty: "1" },
    ]);
  });
});
