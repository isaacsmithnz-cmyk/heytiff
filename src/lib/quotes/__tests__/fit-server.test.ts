/**
 * @jest-environment node
 */
/* Each system's parts checked against its own outdoor unit, read off the
   maker's data pack; a Daikin system has no pack, so nothing in it is checked. */
jest.mock("server-only", () => ({}));
const lookupUnit = jest.fn();
jest.mock("../lookups-server", () => ({ lookupUnit: (...a: unknown[]) => lookupUnit(...a) }));

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
