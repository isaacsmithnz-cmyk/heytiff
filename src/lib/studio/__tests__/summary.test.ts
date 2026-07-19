/* Summary derivations — the design-basis line the summary chips and the
   printed pack header both render. Settings-shaped inputs, label outputs. */

import { createDesign } from "../document";
import { DEFAULT_CLIMATE_ZONE } from "../loads";
import {
  designBasis,
  effectiveBuildingType,
  effectiveClimateZone,
} from "../summary";

describe("effective settings", () => {
  it("falls back to the default zone when unset or unparsable", () => {
    const d = createDesign({ name: "T", mode: "blank" });
    expect(effectiveClimateZone(d.settings)).toBe(DEFAULT_CLIMATE_ZONE);
    d.settings.climateZone = "nope";
    expect(effectiveClimateZone(d.settings)).toBe(DEFAULT_CLIMATE_ZONE);
    d.settings.climateZone = "99"; // not a table zone
    expect(effectiveClimateZone(d.settings)).toBe(DEFAULT_CLIMATE_ZONE);
  });

  it("parses a stored zone string", () => {
    const d = createDesign({ name: "T", mode: "blank" });
    d.settings.climateZone = "7";
    expect(effectiveClimateZone(d.settings)).toBe(7);
  });

  it("building type falls back to residential", () => {
    const d = createDesign({ name: "T", mode: "blank" });
    expect(effectiveBuildingType(d.settings)).toBe("residential");
    d.settings.buildingType = "commercial";
    expect(effectiveBuildingType(d.settings)).toBe("commercial");
    d.settings.buildingType = "mystery";
    expect(effectiveBuildingType(d.settings)).toBe("residential");
  });
});

describe("designBasis", () => {
  it("labels the settings for chips and print", () => {
    const d = createDesign({ name: "T", mode: "blank" });
    d.settings.climateZone = "6";
    d.settings.buildingType = "light_commercial";
    d.settings.sizingBasis = "heating";
    const b = designBasis(d);
    expect(b.zone).toBe(6);
    expect(b.zoneLabel).toMatch(/Zone 6/);
    expect(b.zoneCity).toBe("Melbourne");
    expect(b.buildingLabel).toBe("Light commercial");
    expect(b.basisLabel).toBe("Sized on heating");
  });

  it("defaults produce the standard basis line", () => {
    const d = createDesign({ name: "T", mode: "blank" });
    const b = designBasis(d);
    expect(b.zone).toBe(DEFAULT_CLIMATE_ZONE);
    expect(b.zoneCity).toBe("Sydney");
    expect(b.buildingLabel).toBe("Residential");
    expect(b.basisLabel).toBe("Sized on worst of both");
  });
});
