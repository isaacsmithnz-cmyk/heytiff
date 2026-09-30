/* The components a quote prices, and the sums that price them. Names are
   the live price book's own (2026-09-30). */
import {
  amountCents,
  colourOf,
  withoutColour,
  buyPerUnitCents,
  matchesComponent,
  profitSharePct,
  rollMetresOf,
  sellCents,
} from "../components";
import { normaliseQuoteSettings, quoteSettingsRow, DEFAULT_QUOTE_SETTINGS } from "../settings";
import { rankGroups, type ComponentGroup } from "../settings-query";

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

describe("which price-book items a component matches", () => {
  it("tells the pair coil sizes apart", () => {
    const name = "PAIRED COIL 1/4+1/2X20M (6.35-12.7) 9mm (R.61/.52)";
    expect(matchesComponent("pair_coil_14_12", name)).toBe(true);
    expect(matchesComponent("pair_coil_14_38", name)).toBe(false);
    expect(matchesComponent("pair_coil_14_12", "Pair Coil - 1/4 + 1/2")).toBe(true);
    expect(matchesComponent("pair_coil_38_58", "PAIRED COIL 3/8 + 5/8 X 10M 9mm(R.55/.49)")).toBe(true);
    /* Reece's own words, and its fire-rated coil kept apart */
    expect(matchesComponent("pair_coil_14_12", 'ARDENT PR CU 1/4" X 1/2"       R410A 20M (COIL)')).toBe(true);
    expect(matchesComponent("pair_coil_14_12", 'ARDENT PR CU FR 13MM 1/4"-1/2" R410A 20M (COIL)')).toBe(false);
  });

  it("takes the cable, not the slotted angle of the same gauge", () => {
    expect(matchesComponent("power_cable", "2.5mm Twin and Earth Flat Cable (Per Meter)")).toBe(true);
    expect(matchesComponent("power_cable", "SLOTTED ANGLE 40X40-2.5mm 3M")).toBe(false);
  });

  it("takes a length of cover, not a joint or a fitting", () => {
    expect(matchesComponent("pipe_cover", "SMARTDUCT DRAIN Y JOINT 0021GY (EA)")).toBe(false);
    expect(matchesComponent("pipe_cover", "SMARTDUCT FAST BLOCK 110MM 1203ST (EA)")).toBe(false);
    expect(matchesComponent("pipe_cover", "WOODLAND GREY METAL TRUNKING 2.4M (EA)")).toBe(true);
  });

  it("takes the isolator switch, not an anti-vibration mount", () => {
    expect(matchesComponent("isolator", "VIB ISOLATION MOUNT 15-30KG SILVER (EA)")).toBe(false);
    expect(matchesComponent("isolator", "240V 20A IP66 W/PROOF ISOLATOR LOCKABLE (EA)")).toBe(true);
  });

  it("takes a pump, not its adaptor kit", () => {
    expect(matchesComponent("condensate_pump", "ASPEN MINI ORANGE CONDENSATE PUMP")).toBe(true);
    expect(matchesComponent("condensate_pump", "CONDENSATE PUMP ADAPTOR KIT 6MM (EA)")).toBe(false);
  });
});

describe("a roll's length, read off the name", () => {
  it.each([
    ["PAIRED COIL 1/4+1/2X20M (6.35-12.7) 9mm (R.61/.52)", 20],
    ["PAIRED COIL 1/4 + 1/2 X 5M 9mm(R.61/.52)", 5],
    ["2.5MMSQ 7/.67 T&E TPS 450/750V 90C WHITE 100M", 100],
    ["FLEX DRAIN HOSE 50M 16-18mm", 50],
    ["DURA FLEX COND DRAIN HOSE(16/18MM) 50MT (COIL)", 50],
    ["2.5mm Twin and Earth Flat Cable (Per Meter)", 1],
    ["Pair Coil - 1/4 + 1/2", null],
  ])("%s → %s", (name, m) => expect(rollMetresOf(name)).toBe(m));
});

describe("the sums", () => {
  it("prices a metre of the 20 m roll, and sells it with the markup", () => {
    const perM = buyPerUnitCents("m", amountCents("187.18"), 20);
    expect(perM).toBe(936);
    expect(sellCents(perM!, 40)).toBe(1310);
    expect(buyPerUnitCents("m", amountCents("130"), null)).toBeNull();
    expect(buyPerUnitCents("each", amountCents("27.95"), null)).toBe(2795);
  });

  it("says what share of the sell price a markup is", () => {
    expect(profitSharePct(20)).toBe(16.7);
    expect(profitSharePct(40)).toBe(28.6);
    expect(profitSharePct(0)).toBe(0);
  });

  it("ranks the lowest a metre first, unpriced and $0.00 last, the most used breaking a tie", () => {
    const g = (code: string, uses: number, perUnitCents: number | null): ComponentGroup => ({
      code,
      name: code,
      rollM: null,
      uses,
      offers: [{ supplierKey: "aad", supplierName: "AAD", code, pack: null, buyCents: 0, perUnitCents }],
    });
    expect(
      rankGroups([g("a", 0, 900), g("b", 3, 1200), g("c", 0, null), g("d", 0, 800), g("z", 0, 0), g("e", 5, 900)]).map((x) => x.code)
    ).toEqual(["d", "e", "a", "b", "c", "z"]);
  });
});

describe("the settings", () => {
  it("starts at 20% on units, 40% on materials and an 8-hour day", () => {
    expect(normaliseQuoteSettings({})).toEqual(DEFAULT_QUOTE_SETTINGS);
  });

  it("keeps a preferred item and a corrected roll, and drops what it doesn't know", () => {
    const s = normaliseQuoteSettings({
      unit_markup_pct: "25",
      material_markup_pct: 900,
      day_hours: 7.5,
      preferred: {
        pair_coil_14_12: { supplier_key: "aad", code: "PC1412", roll_m: 20 },
        drain_hose: { material_uuid: "an old-style pick" },
        not_a_part: { supplier_key: "aad", code: "x" },
      },
    });
    expect(s).toEqual({
      unitMarkupPct: 25,
      materialMarkupPct: 300,
      dayHours: 7.5,
      preferred: { pair_coil_14_12: { supplierKey: "aad", code: "PC1412", rollM: 20 } },
    });
    expect(quoteSettingsRow(s).preferred).toEqual({ pair_coil_14_12: { supplier_key: "aad", code: "PC1412", roll_m: 20 } });
  });
});

describe("a part's colours", () => {
  it("reads the colour off the name, and groups the colours as one part", () => {
    expect(colourOf("WOODLAND GREY METAL TRUNKING 2.4M (EA)")).toBe("Woodland Grey");
    expect(colourOf("PAIRED COIL 1/4+1/2X20M")).toBeNull();
    expect(withoutColour("SURF MIST METAL TRUNKING 2.4M (EA)")).toBe("METAL TRUNKING 2.4M (EA)");
    expect(withoutColour("WOODLAND GREY METAL TRUNKING 2.4M (EA)")).toBe("METAL TRUNKING 2.4M (EA)");
    expect(withoutColour("BASALT METAL TRUNKING 2.4M (EA)")).toBe("METAL TRUNKING 2.4M (EA)");
  });
});

