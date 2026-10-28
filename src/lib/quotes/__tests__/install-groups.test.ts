/* The common install items in their groups (Isaac, 28 October 2026): every
   part a kit prices, named the trade's way, the ductwork's fittings in the
   inches the trade says them. */
import { COMPONENT_KEYS, matchesComponent } from "../components";
import { INSTALL_GROUPS, fittingWords, suppliersWords } from "../install-groups";
import { RANGE_KEYS } from "../ranges";

const parts = INSTALL_GROUPS.flatMap((g) => g.sections.flatMap((s) => s.parts));

it("holds every part a kit prices, once: each range, and each preferred item but the two whose range stands in for them", () => {
  const ranges = parts.flatMap((p) => ("range" in p ? [p.range] : []));
  const components = parts.flatMap((p) => ("component" in p ? [p.component] : []));
  expect([...ranges].sort()).toEqual([...RANGE_KEYS].sort());
  expect([...components].sort()).toEqual(COMPONENT_KEYS.filter((k) => k !== "isolator" && k !== "wall_bracket").sort());
  expect(INSTALL_GROUPS.map((g) => g.label)).toEqual(["Pipe", "Cable and power", "Drain", "Mounting", "Covering", "Ductwork", "Grilles and outlets", "Controls"]);
});

it("says a fitting as the trade does, in inches", () => {
  expect(fittingWords("AIRLOC SMARTFIT Y 14-10-10 INS", { ins: [350], outs: [250, 250] })).toBe("Y 14-10-10");
  expect(fittingWords("BTO 250.200.150 INSULATED", { ins: [250], outs: [200, 150] })).toBe("BTO 10-8-6");
  expect(fittingWords("AIRLOC SMARTFIT Y 18/20-14-14 INS COMBO", { ins: [450, 500], outs: [350, 350] })).toBe("Y 18/20-14-14");
});

it("names where a group's parts come from in a few words", () => {
  expect(suppliersWords([])).toBeNull();
  expect(suppliersWords(["AAD", "AAD"])).toBe("AAD");
  expect(suppliersWords(["AAD", "Reece", "AAD"])).toBe("AAD and Reece");
  expect(suppliersWords(["AAD", "Reece", "Voltex", "Rexel"])).toBe("AAD, Reece and 2 more");
});

/* the new preferred items, by what they are, whatever a supplier calls them */
it("knows interconnect, the bigger power cables and transmission cable by their names", () => {
  expect(matchesComponent("interconnect", "Flat TPS 3C +E A/ C 7/0. 5 1.5mm PVC/ PVC Blue 450/ 750V per metre")).toBe(true);
  expect(matchesComponent("interconnect", "240V Hard Wired Photoelectric Smoke Alarm; Wired Interconnect")).toBe(false);
  expect(matchesComponent("interconnect", "Circular Unarm 4C +E 10mm PVC/ PVC Orange per metre")).toBe(false);
  expect(matchesComponent("power_cable_4", "Cable Tps 4Mm 7/085 2C+E per metre")).toBe(true);
  expect(matchesComponent("power_cable_4", "Cable Tps 2.5Mm 7/067 2C+E100M per metre")).toBe(false);
  expect(matchesComponent("power_cable_4", "Circular Unarmoured 2C +E 4mm PVC/ PVC Orange per metre")).toBe(false);
  expect(matchesComponent("power_cable_6", "Flat Twin 2C +E 6mm PVC/ PVC White 450- 750V per metre")).toBe(true);
  expect(matchesComponent("power_cable_6", "SDI 6MM SINGLE CORE BLACK 100M")).toBe(false);
  expect(matchesComponent("transmission_cable", "1.5MM 1 PAIR CORE SHIELDED CABLE 100MTR (ROLL)")).toBe(true);
  expect(matchesComponent("transmission_cable", "Cat6 10G Cable 4Pr UnShielded LSZH Sheath Blue 305m")).toBe(false);
});

it("reads an RCBO's rating and poles, and keeps its range to breakers", async () => {
  const { RANGE_KINDS, inKind, fitOf } = await import("../ranges");
  const name = "UniLine Single Module RCBO - 20A; 30mA; 4.5kA; C-Curve; Type A; 1P+N; Universal";
  expect(inKind("rcbo", name)).toBe(true);
  expect(RANGE_KINDS.rcbo.sizeOf(name)).toEqual({ amps: 20, poles: 1 });
  expect(inKind("rcbo", "DIN RAIL RCBO BUSBAR 12 POLE")).toBe(false);
  expect(fitOf("rcbo", { amps: 20, poles: 1 }, { amps: 18, phase: "1" })).toBe(20);
  expect(fitOf("rcbo", { amps: 20, poles: 1 }, { amps: 18, phase: "3" })).toBeNull();
  expect(matchesComponent("spring_hangers", "SPRING HANGER KIT UNDERFLOOR 4 PACK")).toBe(true);
  expect(matchesComponent("spring_hangers", "FLEX DUCT HANGING STRAP 25M")).toBe(false);
});
