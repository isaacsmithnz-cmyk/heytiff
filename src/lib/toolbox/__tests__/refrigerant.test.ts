/* Refrigerant PT math — table lookups, interpolation, inverse lookup,
   superheat/subcool, unit conversion, operating windows. */

import {
  kpaToPsi,
  psiToKpa,
  R32_SAT,
  R410A_SAT,
  satPressureKpa,
  satTempC,
  subcoolingK,
  superheatK,
  windowPressures,
  COOLING_WINDOWS,
} from "../refrigerant";

describe("saturation tables", () => {
  it("cover −20…65°C in 5° steps, strictly increasing", () => {
    for (const table of [R32_SAT, R410A_SAT]) {
      expect(table[0].c).toBe(-20);
      expect(table[table.length - 1].c).toBe(65);
      expect(table).toHaveLength(18);
      for (let i = 1; i < table.length; i++) {
        expect(table[i].c - table[i - 1].c).toBe(5);
        expect(table[i].kpa).toBeGreaterThan(table[i - 1].kpa);
      }
    }
  });

  it("R32 runs slightly higher than R410A at like temperature (above −10°C)", () => {
    for (let i = 0; i < R32_SAT.length; i++) {
      if (R32_SAT[i].c >= -10) {
        expect(R32_SAT[i].kpa).toBeGreaterThan(R410A_SAT[i].kpa);
      }
    }
  });

  it("field-chart anchors: 25°C ≈ 1605 (R32) / 1553 (R410A) kPa gauge", () => {
    expect(satPressureKpa("R32", 25)).toBe(1605);
    expect(satPressureKpa("R410A", 25)).toBe(1553);
  });
});

describe("satPressureKpa / satTempC", () => {
  it("hits table points exactly and interpolates between them", () => {
    expect(satPressureKpa("R410A", 0)).toBe(697);
    // midpoint 2.5°C between 697 and 832 → 764.5
    expect(satPressureKpa("R410A", 2.5)).toBe(764.5);
  });

  it("returns null outside the chart", () => {
    expect(satPressureKpa("R32", -25)).toBeNull();
    expect(satPressureKpa("R32", 70)).toBeNull();
    expect(satTempC("R410A", 100)).toBeNull();
    expect(satTempC("R410A", 9999)).toBeNull();
  });

  it("satTempC inverts satPressureKpa within rounding", () => {
    for (const t of [-10, 0, 7, 25, 43, 60]) {
      const p = satPressureKpa("R32", t)!;
      expect(Math.abs(satTempC("R32", p)! - t)).toBeLessThanOrEqual(0.1);
    }
  });
});

describe("superheat / subcooling", () => {
  it("superheat = line temp − sat temp", () => {
    // R410A 832 kPag → 5°C sat; line at 12°C → 7 K superheat
    expect(superheatK("R410A", 832, 12)).toBe(7);
  });

  it("subcooling = sat temp − line temp", () => {
    // R410A 2319 kPag → 40°C sat; liquid line at 33°C → 7 K subcool
    expect(subcoolingK("R410A", 2319, 33)).toBe(7);
  });

  it("negative results pass through (flooding / flash gas)", () => {
    expect(superheatK("R410A", 832, 2)).toBe(-3);
    expect(subcoolingK("R410A", 2319, 45)).toBe(-5);
  });

  it("null when pressure is off-chart", () => {
    expect(superheatK("R32", 50, 10)).toBeNull();
    expect(subcoolingK("R32", 9000, 30)).toBeNull();
  });
});

describe("units", () => {
  it("kPa ↔ psi round trip", () => {
    expect(kpaToPsi(1553)).toBeCloseTo(225.2, 0);
    expect(psiToKpa(kpaToPsi(1000))).toBeCloseTo(1000, 0);
  });
});

describe("operating windows", () => {
  it("cooling suction window derives from the sat table per refrigerant", () => {
    const w = COOLING_WINDOWS[0]; // 0–12°C
    expect(windowPressures("R410A", w)).toEqual({ lo: 697, hi: 1052 });
    expect(windowPressures("R32", w)!.lo).toBe(716);
  });
});
