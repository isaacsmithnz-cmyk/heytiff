/* What a unit has, read off its supplier's own description (Isaac,
   2026-10-05: the Mitsubishi letters were read by hand, from documents he
   gave directly; every supplier already writes it on the item). Every name
   below is a real one from AAD, Mitsubishi Electric or Temperzone. */
import { FEATURE_WORDS, descriptionFeatures, isUnitDescription, unitFeatures } from "../features";

describe("a unit's features, in its supplier's words", () => {
  it.each([
    ["MHI AVANTI HWS IND 2.5KW R/C INV WIFI", [FEATURE_WORDS.wifi]],
    ["MITS. ELEC. M/H EF HWS IND 2.2KW SLVR WIFI", [FEATURE_WORDS.wifi]],
    ["Gree R32 Window Unit 2.7kW WIFI", [FEATURE_WORDS.wifi]],
    ["White Indoor Unit - wireless R/C with WiFi", [FEATURE_WORDS.wifi]],
    ["DAIKIN MULTI OUT 6.8KW 4-PORT R32 DRED", [FEATURE_WORDS.dred]],
    ["R32 Dred Outdoor Unit 5.4kW 2-3 Port", [FEATURE_WORDS.dred]],
    ["Low-Profile Ducted with Drain Pump", [FEATURE_WORDS.drainPump]],
    ["HISENSE MULTI B/HEAD IND 5.3KW W/PUMP", [FEATURE_WORDS.drainPump]],
    ["SPLIT SYSTEM 7.1KW + WIFI ADAPTOR", [FEATURE_WORDS.wifiAdaptor]],
    ["PANASONIC Z SERIES HW SPLIT IND 2.5KW", []],
  ])("%s", (name, words) => {
    expect(descriptionFeatures(name)).toEqual(words);
  });

  it("never gives a part for a unit the unit's features", () => {
    for (const name of [
      "DAI D-MOBILE RA WIFI ADAPTER",
      "ACT ACC PREMIUM WIRED CONTROLLER WI-FI",
      "DAI DRED ADAPTOR RXV/M/F20-35",
      "ME ACC DRAIN PUMP PCA-M50KA",
      "Drain Pump PCA-M71-140",
      "iZONE SMART HUB WI-FI",
      "BRA KIT MAGIQTOUCH WIFI MODULE",
    ]) {
      expect([name, isUnitDescription(name), descriptionFeatures(name)]).toEqual([name, false, []]);
    }
  });
});

describe("a unit's features, its description first", () => {
  it("takes what the description says, then what the maker's code letters add", () => {
    /* the description says Wi-Fi; the code's D adds DRED */
    expect(unitFeatures("Indoor Unit - wireless R/C with WiFi", "MSZ-AP25VGKD2-A2")).toEqual([FEATURE_WORDS.wifi, FEATURE_WORDS.dred]);
    /* a description that says nothing leaves it to the code */
    expect(unitFeatures("R32 Outdoor", "MUZ-AP71VGD2-A2")).toEqual([FEATURE_WORDS.dred]);
    /* another maker's unit, by its description alone */
    expect(unitFeatures("DAIKIN PREMIUM OUT 7.1KW 3PH R32 DRED", "RZQ71LV1")).toEqual([FEATURE_WORDS.dred]);
    /* a unit sold with an adaptor never also reads as Wi-Fi built in */
    expect(unitFeatures("SPLIT SYSTEM 2.5KW + WIFI ADAPTOR", "MSZ-AP25VGKD2-A2")).toEqual([FEATURE_WORDS.wifiAdaptor, FEATURE_WORDS.dred]);
  });
});
