import { buildSettingsOf, contingencyOf, unsetWords } from "../build-settings";
import { orgDayOf } from "../org-day";
import { DEFAULT_QUOTE_SETTINGS, type QuoteSettings } from "../settings";

/* Isaac, 2026-10-04: "no made up figures… then give the contingency a
   home… the quote builder can warn you". */
const day = orgDayOf({ chargeOutCents: 15000, dayHours: 7.5 }, null);
const set: QuoteSettings = { ...DEFAULT_QUOTE_SETTINGS, unitMarkupPct: 25, materialMarkupPct: 40, contingencyPct: 15, contingencyHours: 2 };

describe("what a priced quote is built on", () => {
  it("is every figure of the business's own, contingency included", () => {
    expect(buildSettingsOf(set, day)).toEqual({
      ok: true,
      settings: { unitMarkupPct: 25, materialMarkupPct: 40, chargeOutCents: 15000, dayHours: 7.5, contingency: { pct: 15, hours: 2 } },
    });
  });

  it("carries no contingency the business didn't set, and a share or hours alone", () => {
    expect(contingencyOf(DEFAULT_QUOTE_SETTINGS)).toBeNull();
    expect(contingencyOf({ contingencyPct: 0, contingencyHours: 0 })).toBeNull();
    expect(contingencyOf({ contingencyPct: 10, contingencyHours: null })).toEqual({ pct: 10, hours: 0 });
    expect(contingencyOf({ contingencyPct: null, contingencyHours: 3 })).toEqual({ pct: 0, hours: 3 });
  });

  it("says what isn't set, and prices nothing on a guess", () => {
    const r = buildSettingsOf(DEFAULT_QUOTE_SETTINGS, orgDayOf({ chargeOutCents: null, dayHours: null }, null));
    expect(r).toEqual({ ok: false, unset: ["rate", "hours", "unit_markup", "material_markup"] });
    expect(unsetWords(["rate", "hours", "unit_markup", "material_markup"])).toBe(
      "Set a charge-out rate, a working day, a markup on units and a markup on materials in Quoting to price this quote."
    );
    expect(unsetWords(["hours"])).toBe("Set a working day in Quoting to price this quote.");
  });
});
