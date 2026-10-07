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
