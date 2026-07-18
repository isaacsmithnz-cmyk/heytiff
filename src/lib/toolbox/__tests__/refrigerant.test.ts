/* Refrigerant PT data + math — 7 Australian-relevant refrigerants, dual
   liquid/vapor columns (glide-aware), interpolation, inverse lookup,
   superheat/subcool, unit conversion, operating windows. */

import {
  getRefrigerant,
  kpaToPsi,
  psiToKpa,
  REFRIGERANT_KEYS,
  REFRIGERANTS,
  satPressureKpa,
  satTempC,
  subcoolingK,
  superheatK,
  windowPressures,
} from "../refrigerant";

describe("refrigerant catalogue", () => {
  it("covers the 7 AU-relevant refrigerants, most relevant first", () => {
    expect(REFRIGERANT_KEYS).toEqual(["R32", "R410A", "R22", "R407C", "R134a", "R404A", "R290"]);
  });

  it("every table spans −20…65°C in 5° steps, strictly increasing both columns", () => {
    for (const r of REFRIGERANTS) {
      expect(r.table).toHaveLength(18);
      expect(r.table[0].c).toBe(-20);
      expect(r.table[17].c).toBe(65);
      for (let i = 1; i < r.table.length; i++) {
        expect(r.table[i].c - r.table[i - 1].c).toBe(5);
        expect(r.table[i].liquid).toBeGreaterThan(r.table[i - 1].liquid);
        expect(r.table[i].vapor).toBeGreaterThan(r.table[i - 1].vapor);
      }
    }
  });

  it("pure fluids use one column; blends carry their real liquid/vapor columns", () => {
    for (const r of REFRIGERANTS) {
      for (const p of r.table) {
        if (r.key === "R407C") {
          expect(p.liquid).toBeGreaterThan(p.vapor); // real glide: bubble ≫ dew
        } else if (r.key === "R410A" || r.key === "R404A") {
          expect(p.liquid).toBeGreaterThanOrEqual(p.vapor); // near-azeotrope
          expect(p.liquid - p.vapor).toBeLessThanOrEqual(15);
        } else {
          expect(p.liquid).toBe(p.vapor); // pure fluid
        }
      }
    }
    // glide ≈ 6 K: dew temp at the 0°C bubble pressure sits ~6 K above 0
    const dewAtBubble0 = satTempC("R407C", 467, "vapor")!;
    expect(dewAtBubble0).toBeGreaterThan(4.5);
    expect(dewAtBubble0).toBeLessThan(7.5);
  });

  it("field-chart anchor points hold", () => {
    expect(satPressureKpa("R32", 25)).toBe(1588);
    expect(satPressureKpa("R410A", 25)).toBe(1551); // vapor column
    expect(satPressureKpa("R22", 0)).toBe(397);
    expect(satPressureKpa("R134a", 25)).toBe(564);
    expect(satPressureKpa("R404A", -10)).toBe(330); // vapor; liquid = 338
    expect(satPressureKpa("R404A", -10, "liquid")).toBe(338);
    expect(satPressureKpa("R290", 25)).toBe(851);
    expect(satPressureKpa("R407C", 25, "liquid")).toBe(1089);
    expect(satPressureKpa("R407C", 25, "vapor")).toBe(919);
  });

  it("metadata carries safety + usage context", () => {
    expect(getRefrigerant("R32").flammable).toBe(true); // A2L
    expect(getRefrigerant("R290").safety).toContain("A3");
    expect(getRefrigerant("R410A").flammable).toBe(false);
    expect(getRefrigerant("R22").status).toContain("Phase-out");
    for (const r of REFRIGERANTS) {
      expect(r.uses.length).toBeGreaterThan(10);
      expect(r.color).toMatch(/^#/);
      expect(r.cooling.length).toBeGreaterThan(0);
    }
  });
});

describe("satPressureKpa / satTempC", () => {
  it("hits table points exactly and interpolates between them", () => {
    expect(satPressureKpa("R410A", 0)).toBe(697);
    // midpoint 2.5°C between 697 and 833 → 765
    expect(satPressureKpa("R410A", 2.5)).toBe(765);
  });

  it("returns null outside the chart", () => {
    expect(satPressureKpa("R32", -25)).toBeNull();
    expect(satPressureKpa("R32", 70)).toBeNull();
    expect(satTempC("R134a", 20)).toBeNull();
    expect(satTempC("R410A", 9999)).toBeNull();
  });

  it("satTempC inverts satPressureKpa within rounding, per side", () => {
    for (const key of REFRIGERANT_KEYS) {
      for (const t of [-10, 0, 7, 25, 43, 60]) {
        for (const side of ["liquid", "vapor"] as const) {
          const p = satPressureKpa(key, t, side)!;
          expect(Math.abs(satTempC(key, p, side)! - t)).toBeLessThanOrEqual(0.1);
        }
      }
    }
  });
});

describe("superheat / subcooling", () => {
  it("superheat = line temp − DEW temp at suction pressure", () => {
    // R410A 832 kPag → 5°C sat; line at 12°C → 7 K
    expect(superheatK("R410A", 832, 12)).toBe(7);
    // R407C reads the vapor column: 359 kPag → dew 0°C; line 7°C → 7 K
    expect(superheatK("R407C", 359, 7)).toBe(7);
  });

  it("subcooling = BUBBLE temp at liquid pressure − line temp", () => {
    // R410A 2324 kPag → bubble 40°C; liquid line at 33°C → 7 K
    expect(subcoolingK("R410A", 2324, 33)).toBe(7);
    // R407C reads the liquid column: 1089 kPag → bubble 25°C; line 18°C → 7 K
    expect(subcoolingK("R407C", 1089, 18)).toBe(7);
  });

  it("negative results pass through (flooding / flash gas)", () => {
    expect(superheatK("R410A", 832, 2)).toBe(-3);
    expect(subcoolingK("R410A", 2324, 45)).toBe(-5);
  });

  it("null when pressure is off-chart", () => {
    expect(superheatK("R32", 50, 10)).toBeNull();
    expect(subcoolingK("R32", 9000, 30)).toBeNull();
  });
});

describe("units", () => {
  it("kPa ↔ psi round trip", () => {
    expect(kpaToPsi(1551)).toBeCloseTo(225, 0);
    expect(psiToKpa(kpaToPsi(1000))).toBeCloseTo(1000, 0);
  });
});

describe("operating windows", () => {
  it("cooling suction band derives from the vapor column per refrigerant", () => {
    const w = getRefrigerant("R410A").cooling.find((x) => x.key === "cool-suction")!;
    expect(windowPressures("R410A", w)).toEqual({ lo: 697, hi: 1052 });
    expect(windowPressures("R32", w)!.lo).toBe(712);
  });

  it("R404A carries refrigeration duty windows (MT + LT + discharge)", () => {
    const r = getRefrigerant("R404A");
    const keys = r.cooling.map((w) => w.key);
    expect(keys).toEqual(expect.arrayContaining(["mt-suction", "lt-suction", "cool-discharge"]));
    for (const w of r.cooling) {
      expect(windowPressures("R404A", w)).not.toBeNull();
    }
    expect(r.heating).toHaveLength(0); // no heat-pump duty band for cold rooms
  });

  it("discharge bands read the liquid column on glide blends", () => {
    const w = getRefrigerant("R407C").cooling.find((x) => x.key === "cool-discharge")!;
    const band = windowPressures("R407C", w)!;
    expect(band.lo).toBe(1648); // bubble at 40°C, not dew (1440)
  });
});
