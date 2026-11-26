import type { UnitLookup, UnitSpecs } from "../lookups";
import { fitChecks, pipeOf, type FitPart } from "../fit";

/* Does each part fit the unit it's for (slice 3.1), on the Mitsubishi pack's
   own figures: the PUZ-ZM125VKA2 draws 28 A, connects 3/8 + 5/8, is 1,050
   mm wide and 114 kg; the MUZ-AP80VG2 draws 16 A, connects 1/4 + 1/2, is
   840 mm wide and 53 kg. */

const specs = (o: Partial<UnitSpecs>): UnitLookup => ({
  found: true,
  pack: "mitsubishi-electric",
  specs: { role: "outdoor", model: "PUZ-ZM125VKA2-A", coolKw: 12.5, heatKw: 14, sizeMm: [1050, 330, 981], weightKg: 114, soundDba: { low: null, high: 49 }, phase: "1", maxAmps: 28, mcaAmps: null, pipeMm: { liquid: 9.52, gas: 15.88 }, ...o },
});
const zm125 = specs({});
const ap80 = specs({ model: "MUZ-AP80VG2", sizeMm: [840, 330, 880], weightKg: 53, maxAmps: 16, pipeMm: { liquid: 6.35, gas: 12.7 } });
const part = (key: string, name: string, system = "Downstairs", code: string | null = null): FitPart => ({ key, system, name, code });

it("reads a pair coil's sizes off its name", () => {
  expect(pipeOf("PAIRED COIL 3/8+5/8X20M")).toEqual({ liquid: 9.52, gas: 15.88 });
  expect(pipeOf("Pair coil 1/4 + 1/2, 20 m roll")).toEqual({ liquid: 6.35, gas: 12.7 });
  expect(pipeOf("Flex 250")).toBeNull();
});

it("an isolator and a breaker at or over what the unit draws fit; under it, they say by how much", () => {
  const fits = fitChecks([part("iso", "Isolator 35 A"), part("rcbo", "RCBO 32 A"), part("small", "Isolator 20 A")], new Map([["Downstairs", zm125]]));
  expect(fits).toEqual([
    { key: "iso", state: "fitted", why: "35 A for the PUZ-ZM125VKA2-A's 28 A" },
    { key: "rcbo", state: "fitted", why: "32 A for the PUZ-ZM125VKA2-A's 28 A" },
    { key: "small", state: "misfit", why: "20 A is under the PUZ-ZM125VKA2-A's 28 A" },
  ]);
});

it("the pipe has to be the unit's own connections", () => {
  const fits = fitChecks([part("big", "Pair coil 3/8 + 5/8", "Downstairs", "PC3858"), part("ap", "Pair coil 3/8 + 5/8", "Split", "PC3858")], new Map([["Downstairs", zm125], ["Split", ap80]]));
  expect(fits[0]).toEqual({ key: "big", state: "fitted", why: "The PUZ-ZM125VKA2-A connects 3/8 + 5/8" });
  expect(fits[1]).toEqual({ key: "ap", state: "misfit", why: "The MUZ-AP80VG2 connects 1/4 + 1/2" });
});

it("a bracket by the unit's width and weight: a 180 kg bracket doesn't fit a 1,050 mm unit", () => {
  const fits = fitChecks([part("b", "Wall bracket 180KG", "Downstairs", "CWB180"), part("b2", "Wall bracket 180KG", "Split", "CWB180")], new Map([["Downstairs", zm125], ["Split", ap80]]));
  expect(fits[0]).toEqual({ key: "b", state: "misfit", why: "The PUZ-ZM125VKA2-A is 1050 mm wide, 114 kg: it needs a CWBX" });
  expect(fits[1]).toEqual({ key: "b2", state: "fitted", why: "Holds the MUZ-AP80VG2, 53 kg" });
});

it("a brand with no data pack is not checked, never fitted on a guess", () => {
  const fits = fitChecks([part("iso", "Isolator 20 A", "Downstairs")], new Map<string, UnitLookup>([["Downstairs", { found: false, reason: "no data pack" }]]));
  expect(fits).toEqual([{ key: "iso", state: "not checked", why: "No data pack for this brand" }]);
});

it("leaves parts no rule knows as they are", () => {
  expect(fitChecks([part("f", "Flex 250, 6 m bag"), part("h", "Spring hangers, 15 to 30 kg")], new Map([["Downstairs", zm125]]))).toEqual([]);
});

/* A VRF's or a multi's pipe is more than its outdoor's stubs (26 November
   2026: a PUMY quote's 1/4 + 1/2 coil, run between joints and to its P20
   heads as the book sizes it, was flagged against the outdoor's 3/8 + 5/8) */
describe("a VRF or a multi-head system's pipe", () => {
  const pumy = specs({ model: "PUMY-SP140VKMD2-A", pipeMm: { liquid: 9.52, gas: 15.88 } });
  const mxz = specs({ model: "MXZ-3F54VGD", pipeMm: { liquid: 6.35, gas: 9.52 } });
  const vrf = {
    multi: true,
    heads: [
      { model: "PEFY-P80VMA-E4", pipeMm: { liquid: 9.52, gas: 15.88 } },
      { model: "PEFY-P20VMX-E", pipeMm: { liquid: 6.35, gas: 12.7 } },
    ],
    sections: [{ liquid: 6.35, gas: 12.7 }, { liquid: 9.52, gas: 15.88 }],
  };

  it("fits the outdoor's own stubs, a head's connection, or a size its pipe table gives a run", () => {
    const fits = fitChecks(
      [part("main", "PAIRED COIL 3/8+5/8X20M", "Upstairs", "PC3858"), part("branch", "PAIRED COIL 1/4+1/2X20M (6.35-12.7)", "Upstairs", "PC1412")],
      new Map([["Upstairs", pumy]]),
      new Map([["Upstairs", vrf]])
    );
    expect(fits).toEqual([
      { key: "main", state: "fitted", why: "The PUMY-SP140VKMD2-A connects 3/8 + 5/8" },
      { key: "branch", state: "fitted", why: "The PEFY-P20VMX-E connects 1/4 + 1/2" },
    ]);
    const tableOnly = fitChecks([part("branch", "Pair coil 1/4 + 1/2", "Upstairs", "PC1412")], new Map([["Upstairs", pumy]]), new Map([["Upstairs", { ...vrf, heads: [] }]]));
    expect(tableOnly[0]).toEqual({ key: "branch", state: "fitted", why: "A size the PUMY-SP140VKMD2-A's pipe table gives its runs between joints and to its heads" });
  });

  it("is still a misfit when it's none of those", () => {
    const fits = fitChecks([part("big", "Pair coil 5/8 + 7/8", "Upstairs", "PC5878")], new Map([["Upstairs", pumy]]), new Map([["Upstairs", vrf]]));
    expect(fits[0]).toEqual({ key: "big", state: "misfit", why: "Not the PUMY-SP140VKMD2-A's 3/8 + 5/8, a head's connection or a size its pipe table gives" });
  });

  it("fits a multi-head's branch to a head bigger than the outdoor's ports", () => {
    const multi = { multi: true, heads: [{ model: "MSZ-AP25VGD", pipeMm: { liquid: 6.35, gas: 9.52 } }, { model: "MSZ-AP50VGD", pipeMm: { liquid: 6.35, gas: 12.7 } }], sections: [{ liquid: 6.35, gas: 9.52 }] };
    const fits = fitChecks([part("port", "Pair coil 1/4 + 3/8", "Bedrooms", "PC1438"), part("head", "Pair coil 1/4 + 1/2", "Bedrooms", "PC1412")], new Map([["Bedrooms", mxz]]), new Map([["Bedrooms", multi]]));
    expect(fits.map((f) => f.state)).toEqual(["fitted", "fitted"]);
    expect(fits[1].why).toBe("The MSZ-AP50VGD connects 1/4 + 1/2");
  });

  it("keeps a single split to its outdoor's own connections", () => {
    const split = { multi: false, heads: [{ model: "MSZ-AP80VG", pipeMm: { liquid: 9.52, gas: 15.88 } }], sections: [] };
    const fits = fitChecks([part("ap", "Pair coil 3/8 + 5/8", "Split", "PC3858")], new Map([["Split", ap80]]), new Map([["Split", split]]));
    expect(fits[0]).toEqual({ key: "ap", state: "misfit", why: "The MUZ-AP80VG2 connects 1/4 + 1/2" });
  });
});
