/**
 * @jest-environment node
 */
/* Each system's parts checked against its own outdoor unit, read off the
   maker's data pack; a Daikin system has no pack, so nothing in it is checked. */
jest.mock("server-only", () => ({}));
const lookupUnit = jest.fn();
const lookupSystemPipes = jest.fn(async (..._a: unknown[]) => null as unknown);
jest.mock("../lookups-server", () => ({ lookupUnit: (...a: unknown[]) => lookupUnit(...a), lookupSystemPipes: (...a: unknown[]) => lookupSystemPipes(...a) }));

import type { QuoteLine } from "../lines";
import { linesFit } from "../fit-server";

const line = (o: Partial<QuoteLine>): QuoteLine => ({
  id: "x", version: 1, updatedAt: "", updatedBy: "", optionIndex: 0, system: "Downstairs", group: "Pipe", position: 0, name: "x",
  code: null, supplierKey: null, kind: "material", qty: 1, unit: "", costCents: 0, sellCents: null, source: "by_hand", why: "", duct: false, ...o,
});

it("checks each system against its own outdoor, and leaves a brand with no pack not checked", async () => {
  lookupUnit.mockImplementation(async (_pack: string, model: string) =>
    model === "PUZ-ZM125VKA2"
      ? { found: true, pack: "mitsubishi-electric", specs: { role: "outdoor", model: "PUZ-ZM125VKA2-A", maxAmps: 28, mcaAmps: null, pipeMm: { liquid: 9.52, gas: 15.88 }, sizeMm: [1050, 330, 981], weightKg: 114 } }
      : { found: true, pack: "mitsubishi-electric", specs: { role: "indoor", model } }
  );
  const fits = await linesFit([
    line({ id: "in", kind: "unit", code: "PEA-M125HAA", name: "Ducted indoor" }),
    line({ id: "out", kind: "unit", code: "PUZ-ZM125VKA2", name: "Outdoor" }),
    line({ id: "iso", name: "Isolator 20 A" }),
    line({ id: "d-unit", system: "Split", kind: "unit", code: "RXV71WVMA", name: "Daikin outdoor" }),
    line({ id: "d-iso", system: "Split", name: "Isolator 20 A" }),
  ]);
  expect(fits).toEqual([
    { key: "iso", state: "misfit", why: "20 A is under the PUZ-ZM125VKA2-A's 28 A" },
    { key: "d-iso", state: "not checked", why: "No data pack for this brand" },
  ]);
});

/* a VRF's branch pipe (26 November 2026: a PUMY quote's 1/4 + 1/2 was
   flagged against the outdoor's 3/8 + 5/8): its heads and its pipe table
   are read with it */
it("fits a VRF's branch pipe to its heads and its pipe table, and asks the table of the outdoor's own pack", async () => {
  const pipe = (liquid: number, gas: number) => ({ liquid, gas });
  lookupUnit.mockImplementation(async (_pack: string, model: string) =>
    model === "PUMY-SP140VKMD2-A"
      ? { found: true, pack: "mitsubishi-electric", specs: { role: "outdoor", model, maxAmps: 30, mcaAmps: null, pipeMm: pipe(9.52, 15.88), sizeMm: null, weightKg: null } }
      : { found: true, pack: "mitsubishi-electric", specs: { role: "indoor", model, pipeMm: model.includes("P80") ? pipe(9.52, 15.88) : pipe(6.35, 12.7) } }
  );
  lookupSystemPipes.mockResolvedValue({ type: "vrf", sizes: [pipe(6.35, 12.7), pipe(9.52, 15.88)] });
  const fits = await linesFit([
    line({ id: "out", system: "Upstairs", kind: "unit", code: "PUMY-SP140VKMD2-A", name: "Mitsubishi VRF outdoor" }),
    line({ id: "big", system: "Upstairs", kind: "unit", code: "PEFY-P80VMA-E4", name: "Ducted head" }),
    line({ id: "small", system: "Upstairs", kind: "unit", code: "PEFY-P20VMX-E", name: "Ducted head", qty: 2 }),
    line({ id: "main", system: "Upstairs", name: "PAIRED COIL 3/8+5/8X20M", code: "PC3858" }),
    line({ id: "branch", system: "Upstairs", name: "PAIRED COIL 1/4+1/2X20M (6.35-12.7)", code: "PC1412" }),
  ]);
  expect(lookupSystemPipes).toHaveBeenCalledWith("mitsubishi-electric", "PUMY-SP140VKMD2-A");
  expect(fits).toEqual([
    { key: "main", state: "fitted", why: "The PUMY-SP140VKMD2-A connects 3/8 + 5/8" },
    { key: "branch", state: "fitted", why: "The PEFY-P20VMX-E connects 1/4 + 1/2" },
  ]);
});
