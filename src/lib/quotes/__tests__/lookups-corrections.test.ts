/**
 * @jest-environment node
 */
/* The quote reads a unit's specs off the pack as the Studio does: with
   HQ's corrections on. Before 27 Nov 2026 it read the pack as installed,
   so a spec HQ had corrected could pass the design's checks and fail the
   quote's. When the corrections can't be read, the pack as installed. */
jest.mock("server-only", () => ({}));

let OVERRIDES: { data: unknown[] | null; error: { message: string } | null } = { data: [], error: null };
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        then: (resolve: (v: unknown) => void) => resolve(table === "pack_overrides" ? OVERRIDES : { data: [], error: null }),
      };
      return q;
    },
  },
}));

import { lookupUnit } from "../lookups-server";

const BRAND = "mitsubishi-electric";
const MODEL = "MUZ-AP25VG2";

beforeEach(() => {
  OVERRIDES = { data: [], error: null };
});

test("with no corrections, the unit's weight is the pack's", async () => {
  const r = await lookupUnit(BRAND, MODEL);
  expect(r.found).toBe(true);
  if (r.found) expect(r.specs.weightKg).toBe(34);
});

test("a correction HQ made reaches the quote's lookup", async () => {
  OVERRIDES = {
    data: [{ section: "outdoor_units", row_key: MODEL, field: "weight_kg", value: 36, entered_by: "hq", entered_at: "2026-11-27T00:00:00Z" }],
    error: null,
  };
  const r = await lookupUnit(BRAND, MODEL);
  expect(r.found).toBe(true);
  if (r.found) expect(r.specs.weightKg).toBe(36);
});

test("when the corrections can't be read, the pack as installed", async () => {
  OVERRIDES = { data: null, error: { message: "down" } };
  const r = await lookupUnit(BRAND, MODEL);
  expect(r.found).toBe(true);
  if (r.found) expect(r.specs.weightKg).toBe(34);
});

test("a brand with no pack is still no pack", async () => {
  const r = await lookupUnit("no-such-maker", "ABC123");
  expect(r).toEqual({ found: false, reason: "no data pack" });
});
