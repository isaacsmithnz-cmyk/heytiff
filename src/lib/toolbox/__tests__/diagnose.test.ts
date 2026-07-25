/* Ambient-driven pressure estimation + the pressure-pattern fault matrix. */

import {
  CONDENSER_SPLIT_K,
  DEFAULT_AMBIENT_C,
  diagnose,
  dutiesFor,
  estimatePressures,
  EVAPORATOR_SPLIT_K,
  HP_EVAP_SPLIT_K,
  REFRIG_EVAP_SPLIT_K,
  type DiagnoseInput,
} from "../diagnose";
import { satPressureKpa } from "../refrigerant";

describe("estimatePressures", () => {
  it("cooling keys the high side off ambient and the low side off indoor", () => {
    const e = estimatePressures({ refrigerant: "R32", duty: "cooling", ambientC: 35 });
    expect(e.condSatC).toBe(35 + CONDENSER_SPLIT_K); // 49
    expect(e.evapSatC).toBe(24 - EVAPORATOR_SPLIT_K); // 7
    expect(e.suctionKpa).toBe(satPressureKpa("R32", 7, "vapor"));
    expect(e.dischargeKpa).toBe(satPressureKpa("R32", 49, "liquid"));
    expect(e.offChart).toBe(false);
  });

  it("hotter ambient raises the high side, cooler drops it", () => {
    const mild = estimatePressures({ refrigerant: "R410A", duty: "cooling", ambientC: 25 });
    const hot = estimatePressures({ refrigerant: "R410A", duty: "cooling", ambientC: 40 });
    expect(hot.condSatC).toBeGreaterThan(mild.condSatC);
    expect(hot.dischargeKpa!).toBeGreaterThan(mild.dischargeKpa!);
    // the low side is unmoved by ambient in cooling
    expect(hot.evapSatC).toBe(mild.evapSatC);
  });

  it("heating flips the model — ambient drives the LOW side", () => {
    const e = estimatePressures({ refrigerant: "R32", duty: "heating", ambientC: 7 });
    expect(e.evapSatC).toBe(7 - HP_EVAP_SPLIT_K); // -1
    expect(e.condSatC).toBe(40); // indoor 20 + 20
    const cold = estimatePressures({ refrigerant: "R32", duty: "heating", ambientC: 0 });
    expect(cold.suctionKpa!).toBeLessThan(e.suctionKpa!);
  });

  it("refrigeration uses the tighter coil TD and a box temperature", () => {
    const mt = estimatePressures({ refrigerant: "R404A", duty: "refrigeration", ambientC: 32 });
    expect(mt.evapSatC).toBe(2 - REFRIG_EVAP_SPLIT_K); // -6
    expect(mt.basis).toContain("box");
    // freezer duty stays on-chart thanks to the extended R404A table
    const lt = estimatePressures({
      refrigerant: "R404A",
      duty: "refrigeration",
      ambientC: 32,
      spaceC: -18,
    });
    expect(lt.evapSatC).toBe(-26);
    expect(lt.suctionKpa).not.toBeNull();
    expect(lt.offChart).toBe(false);
  });

  it("reports basis text and sensible per-duty ambient defaults", () => {
    expect(DEFAULT_AMBIENT_C.cooling).toBe(35);
    expect(DEFAULT_AMBIENT_C.heating).toBe(7);
    expect(
      estimatePressures({ refrigerant: "R32", duty: "cooling", ambientC: 35 }).basis
    ).toContain("ambient 35°C");
  });
});

/** build a diagnose input whose measured pressures are offset from expected
    by a given number of saturation Kelvin on each side */
function readingAt(evapOffsetK: number, condOffsetK: number): DiagnoseInput {
  const base = estimatePressures({ refrigerant: "R410A", duty: "cooling", ambientC: 35 });
  return {
    refrigerant: "R410A",
    duty: "cooling",
    ambientC: 35,
    suctionKpa: satPressureKpa("R410A", base.evapSatC + evapOffsetK, "vapor")!,
    dischargeKpa: satPressureKpa("R410A", base.condSatC + condOffsetK, "liquid")!,
  };
}

describe("diagnose — pressure patterns", () => {
  it("on-target readings report normal, severity ok", () => {
    const d = diagnose(readingAt(0, 0));
    expect(d.suction.level).toBe("normal");
    expect(d.discharge.level).toBe("normal");
    expect(d.severity).toBe("ok");
    expect(d.headline).toMatch(/look normal/i);
    expect(d.checks.length).toBeGreaterThan(2);
  });

  it("both low → undercharge / leak", () => {
    const d = diagnose(readingAt(-10, -10));
    expect(d.suction.level).toBe("low");
    expect(d.discharge.level).toBe("low");
    expect(d.severity).toBe("fault");
    expect(d.headline).toMatch(/undercharge or leak/i);
    expect(d.checks.join(" ")).toMatch(/leak search/i);
  });

  it("low suction, normal head → restriction or airflow", () => {
    const d = diagnose(readingAt(-10, 0));
    expect(d.headline).toMatch(/restriction or airflow/i);
    expect(d.checks.join(" ")).toMatch(/filter drier/i);
  });

  it("normal suction, high head → condenser not rejecting heat", () => {
    const d = diagnose(readingAt(0, 12));
    expect(d.discharge.level).toBe("high");
    expect(d.headline).toMatch(/condenser/i);
    expect(d.checks.join(" ")).toMatch(/clean the condenser/i);
  });

  it("both high → overcharge / non-condensables", () => {
    const d = diagnose(readingAt(8, 12));
    expect(d.headline).toMatch(/overcharge/i);
  });

  it("high suction, low head → compressor or reversing valve", () => {
    const d = diagnose(readingAt(8, -12));
    expect(d.headline).toMatch(/compressor or reversing valve/i);
    expect(d.checks.join(" ")).toMatch(/amps/i);
  });

  it("normal suction, low head → compressor not pumping", () => {
    const d = diagnose(readingAt(0, -12));
    expect(d.headline).toMatch(/not pumping/i);
  });

  it("high suction, normal head is a watch, not a fault", () => {
    const d = diagnose(readingAt(8, 0));
    expect(d.severity).toBe("watch");
    expect(d.headline).toMatch(/load|overfeeding/i);
  });

  it("reports the measured vs expected saturation deltas", () => {
    const d = diagnose(readingAt(-10, 0));
    expect(d.suction.deltaK).toBeLessThan(-8);
    expect(d.suction.expectedSatC).toBe(7);
    expect(Math.abs(d.discharge.deltaK!)).toBeLessThanOrEqual(0.2);
  });

  it("off-chart readings still classify (empty system reads low)", () => {
    const d = diagnose({
      refrigerant: "R410A",
      duty: "cooling",
      ambientC: 35,
      suctionKpa: 20, // below the chart floor
      dischargeKpa: 2324,
    });
    expect(d.suction.level).toBe("low");
    expect(d.suction.satC).toBeNull();
    expect(d.severity).toBe("fault");
  });
});

describe("diagnose — superheat / subcool refinement", () => {
  it("adds nothing without line temps", () => {
    const d = diagnose(readingAt(0, 0));
    expect(d.superheatK).toBeNull();
    expect(d.chargeNote).toBeNull();
  });

  it("high superheat + low subcooling reads as undercharge", () => {
    const base = readingAt(-10, -10);
    const d = diagnose({ ...base, suctionLineC: 20, liquidLineC: 48 });
    expect(d.superheatK).toBeGreaterThan(12);
    expect(d.subcoolingK).toBeLessThan(2);
    expect(d.chargeNote).toMatch(/undercharge/i);
  });

  it("low superheat + high subcooling reads as overcharge", () => {
    const base = readingAt(0, 0);
    const d = diagnose({ ...base, suctionLineC: 8, liquidLineC: 34 });
    expect(d.chargeNote).toMatch(/overcharge/i);
  });

  it("both normal confirms the charge looks right", () => {
    const base = readingAt(0, 0);
    const d = diagnose({ ...base, suctionLineC: 14, liquidLineC: 43 });
    expect(d.chargeNote).toMatch(/charge looks right/i);
  });
});

describe("dutiesFor", () => {
  it("heat-pump refrigerants offer cooling + heating", () => {
    expect(dutiesFor("R32")).toEqual(["cooling", "heating"]);
    expect(dutiesFor("R410A")).toEqual(["cooling", "heating"]);
  });

  it("R404A is refrigeration only; R134a spans cooling + refrigeration", () => {
    expect(dutiesFor("R404A")).toEqual(["refrigeration"]);
    expect(dutiesFor("R134a")).toEqual(["cooling", "refrigeration"]);
  });
});
