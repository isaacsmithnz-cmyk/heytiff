import { rebalance, splitFrom } from "../cost-split";

/* The three cost sliders must always total 100 — buildAdminPatch rejects a
   split that doesn't, so a drag that could produce one would be a UI that
   hands the user an unsaveable card. */

describe("rebalance", () => {
  it("always totals 100", () => {
    for (const start of [[34, 33, 33], [50, 30, 20], [100, 0, 0], [0, 0, 100]]) {
      for (let idx = 0; idx < 3; idx++) {
        for (const v of [0, 1, 17, 50, 83, 99, 100]) {
          const out = rebalance(start, idx, v);
          expect(out.reduce((a, b) => a + b, 0)).toBe(100);
        }
      }
    }
  });

  it("sets the dragged slider to exactly what was asked for", () => {
    expect(rebalance([34, 33, 33], 0, 60)[0]).toBe(60);
    expect(rebalance([34, 33, 33], 2, 10)[2]).toBe(10);
  });

  it("shares the remainder in the proportion the others already held", () => {
    // service:admin was 2:1, so 40 left over splits ~27/13
    expect(rebalance([40, 40, 20], 0, 60)).toEqual([60, 27, 13]);
  });

  it("splits evenly when the others are all zero", () => {
    expect(rebalance([100, 0, 0], 0, 40)).toEqual([40, 30, 30]);
  });

  it("puts rounding drift on the first of the others, never on the drag", () => {
    const out = rebalance([33, 33, 34], 1, 33);
    expect(out[1]).toBe(33);
    expect(out.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("rounds fractional inputs rather than storing them", () => {
    expect(rebalance([34.4, 33.2, 32.4], 0, 50.6)).toEqual(expect.arrayContaining([51]));
  });

  it("leaves a single slider alone rather than dividing by zero", () => {
    expect(rebalance([100], 0, 80)).toEqual([80]);
  });

  it("ignores an index that isn't a slider", () => {
    expect(rebalance([34, 33, 33], 7, 50)).toEqual([34, 33, 33]);
  });
});

describe("splitFrom", () => {
  it("reads the stored jsonb", () => {
    expect(splitFrom({ install: 50, service: 30, admin: 20 })).toEqual([50, 30, 20]);
  });

  it("falls back to 34/33/33 when nothing is stored", () => {
    expect(splitFrom(null)).toEqual([34, 33, 33]);
    expect(splitFrom("nonsense")).toEqual([34, 33, 33]);
    expect(splitFrom({})).toEqual([34, 33, 33]);
  });

  it("rounds and ignores non-numeric members", () => {
    expect(splitFrom({ install: 49.6, service: "x", admin: 20 })).toEqual([50, 33, 20]);
  });
});
