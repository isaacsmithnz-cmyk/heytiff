/* Stage-3 lock gate: hand-worked heat-load fixtures + sizing-basis + orientation
   detection + airflow presets. (design-studio-plan.md — Stage 3: "Hand-worked
   load calc fixtures".) Every expected kW below is computed by hand from the
   harvested model: round(area × W/m² × glazing × condition × height × orient)
   watts, ÷1000. */

import {
  CLIMATE_ZONES,
  baseWm2,
  heightMult,
  roomHeatLoadKw,
  sizingCapacityKw,
  unitMeetsLoad,
  bearingToCompass,
  detectOrientation,
  orientationFromWalls,
  requiredAirflowLs,
  ORIENTATIONS,
} from "../loads";
import type { Point as GeomPoint } from "../document";

describe("climate zones + base W/m²", () => {
  it("has all 8 NCC zones with the harvested rule-of-thumb values", () => {
    expect(Object.keys(CLIMATE_ZONES)).toHaveLength(8);
    expect(CLIMATE_ZONES[5].residential).toBe(145); // apprenticeship standard
    expect(CLIMATE_ZONES[1].commercial).toBe(220);
    expect(CLIMATE_ZONES[8].residential).toBe(110);
  });

  it("baseWm2 reads zone × building type, honours override, falls back to Zone 5", () => {
    expect(baseWm2({ climateZone: 5, buildingType: "residential" })).toBe(145);
    expect(baseWm2({ climateZone: 5, buildingType: "commercial" })).toBe(175);
    expect(baseWm2({ climateZone: 6, buildingType: "light_commercial" })).toBe(145);
    expect(baseWm2({ climateZone: 5, buildingType: "residential", override: 200 })).toBe(200);
    expect(baseWm2({ climateZone: 99, buildingType: "residential" })).toBe(145); // fallback
  });
});

describe("heightMult — graduated tall-space factor", () => {
  it("standard band ≤2.7 m is ×1.00", () => {
    expect(heightMult(2.4)).toBe(1);
    expect(heightMult(2.7)).toBe(1);
  });

  it("legacy ×1.10 floor just above the band, then grows with height", () => {
    expect(heightMult(2.8)).toBe(1.1); // floored at the old flat factor
    expect(heightMult(3.0)).toBe(1.125);
    expect(heightMult(3.5)).toBeCloseTo(1.229, 3);
    expect(heightMult(4.0)).toBeCloseTo(1.333, 3);
  });

  it("caps at ×1.50 for warehouse-height spaces", () => {
    expect(heightMult(4.8)).toBe(1.5);
    expect(heightMult(7)).toBe(1.5);
  });
});

describe("roomHeatLoadKw — hand-worked", () => {
  it("base case: 20 m², Zone 5 res, defaults → 20×145 = 2.9 kW", () => {
    expect(roomHeatLoadKw({ areaM2: 20, climateZone: 5, buildingType: "residential" })).toBe(2.9);
  });

  it("west orientation multiplies by 1.30 → 3.77 kW", () => {
    expect(
      roomHeatLoadKw({ areaM2: 20, climateZone: 5, buildingType: "residential", orientation: "W" })
    ).toBe(3.77);
  });

  it("all factors stacked: 25 m² Zone 1 res, high glass, poor, 3.0 m, W → 10.065 kW", () => {
    // 25×185×1.24×1.2×1.125×1.30 = 10064.925 → round → 10065 W
    expect(
      roomHeatLoadKw({
        areaM2: 25, climateZone: 1, buildingType: "residential",
        glazing: "high", condition: "poor", ceilingHeightM: 3.0, orientation: "W",
      })
    ).toBe(10.065);
  });

  it("party wall floors solar gain at the table minimum (orientation ignored)", () => {
    // 20 × 145 × 0.85 (NO_SOLAR_MULT) = 2465 W
    expect(
      roomHeatLoadKw({ areaM2: 20, climateZone: 5, buildingType: "residential", orientation: "W", partyWall: true })
    ).toBe(2.465);
  });

  it("no external walls also floors solar gain at the table minimum", () => {
    expect(
      roomHeatLoadKw({ areaM2: 20, climateZone: 5, buildingType: "residential", orientation: "W", hasExternalWalls: false })
    ).toBe(2.465);
  });

  it("marking external walls never DECREASES the load (monotonic exposure)", () => {
    const internal = roomHeatLoadKw({
      areaM2: 20, climateZone: 5, buildingType: "residential", hasExternalWalls: false,
    });
    for (const orientation of ORIENTATIONS) {
      const exposed = roomHeatLoadKw({
        areaM2: 20, climateZone: 5, buildingType: "residential", orientation,
      });
      expect(exposed).toBeGreaterThanOrEqual(internal);
    }
  });

  it("W/m² override wins over the zone table: 10 m² × 200 = 2.0 kW", () => {
    expect(
      roomHeatLoadKw({ areaM2: 10, climateZone: 5, buildingType: "residential", baseWm2Override: 200 })
    ).toBe(2.0);
  });

  it("light-commercial in Zone 6: 15 m² × 145 = 2.175 kW", () => {
    expect(roomHeatLoadKw({ areaM2: 15, climateZone: 6, buildingType: "light_commercial" })).toBe(2.175);
  });
});

describe("sizing basis", () => {
  const unit = { capacity_cool_kw: 10, capacity_heat_kw: 11.2 };
  it("selects the right rating per basis (worst-of-both = min)", () => {
    expect(sizingCapacityKw(unit, "cooling")).toBe(10);
    expect(sizingCapacityKw(unit, "heating")).toBe(11.2);
    expect(sizingCapacityKw(unit, "worst-of-both")).toBe(10);
    expect(sizingCapacityKw({ capacity_cool_kw: 5.6, capacity_heat_kw: 5.0 }, "worst-of-both")).toBe(5.0);
  });

  it("unitMeetsLoad compares against the basis rating", () => {
    expect(unitMeetsLoad(unit, 9.5, "cooling")).toBe(true);
    expect(unitMeetsLoad(unit, 10.0, "cooling")).toBe(true); // exact fit
    expect(unitMeetsLoad(unit, 10.5, "cooling")).toBe(false);
    expect(unitMeetsLoad(unit, 10.5, "worst-of-both")).toBe(false); // min=10 < 10.5
    expect(unitMeetsLoad(unit, 11.0, "heating")).toBe(true);
  });
});

describe("orientation detection", () => {
  it("bearingToCompass maps the 8 points", () => {
    expect(bearingToCompass(0)).toBe("N");
    expect(bearingToCompass(45)).toBe("NE");
    expect(bearingToCompass(90)).toBe("E");
    expect(bearingToCompass(180)).toBe("S");
    expect(bearingToCompass(270)).toBe("W");
    expect(bearingToCompass(315)).toBe("NW");
    expect(bearingToCompass(360)).toBe("N"); // wraps
  });

  it("detects a wide room's long wall as North (north-up)", () => {
    const rect: GeomPoint[] = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 0, y: 4 },
    ];
    expect(detectOrientation(rect, 0)).toBe("N");
  });

  it("re-detects as West when the north arrow points east (90°)", () => {
    const rect: GeomPoint[] = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 0, y: 4 },
    ];
    expect(detectOrientation(rect, 90)).toBe("W");
  });

  it("returns null for a degenerate polygon", () => {
    expect(detectOrientation([{ x: 0, y: 0 }, { x: 1, y: 1 }], 0)).toBeNull();
  });
});

describe("orientationFromWalls (marked external walls)", () => {
  // edges of this rect: 0=top(N), 1=right(E), 2=bottom(S), 3=left(W)
  const rect: GeomPoint[] = [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 0, y: 4 },
  ];

  it("marks the top edge as North (north-up)", () => {
    expect(orientationFromWalls(rect, [0], 0)).toBe("N");
  });

  it("marks the right edge as East", () => {
    expect(orientationFromWalls(rect, [1], 0)).toBe("E");
  });

  it("picks the longest of several marked walls (length-weighted)", () => {
    // edge 0 (len 10) beats edge 1 (len 4) → North wins
    expect(orientationFromWalls(rect, [0, 1], 0)).toBe("N");
  });

  it("rotates with the north arrow", () => {
    // north points east (90°): the top edge now faces West
    expect(orientationFromWalls(rect, [0], 90)).toBe("W");
  });

  it("returns null when no walls are marked (internal / party room)", () => {
    expect(orientationFromWalls(rect, [], 0)).toBeNull();
  });
});

describe("ventilation airflow presets", () => {
  it("per-room exhaust returns the flat rate", () => {
    expect(requiredAirflowLs("bathroom")).toBe(25);
    expect(requiredAirflowLs("kitchen-domestic")).toBe(40);
  });
  it("per-person supply scales with occupancy", () => {
    expect(requiredAirflowLs("office-fresh-air", { people: 4 })).toBe(40);
  });
  it("unknown space type → 0", () => {
    expect(requiredAirflowLs("nope")).toBe(0);
  });
});
