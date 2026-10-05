/* Ranges that come in sizes (Isaac, 2026-10-04: "you pick one item, say
   your Y 14-10-10, and Tiff finds the same range's other sizes"): each size
   read the way the suppliers write it — every name below is a real one from
   AAD, Reece, J&Z, Ideal Air, Advantage Air or Go — and the size a kit line
   takes from a range. */
import {
  RANGE_KINDS,
  diameterOf,
  faceOf,
  fitOf,
  fittingOf,
  forTheOutdoorsCurrent,
  forTheOutdoorsSize,
  inKind,
  isolatorOf,
  needWords,
  neckOf,
  pickFromRange,
  rangeNeedOf,
  sameLine,
  sizeWords,
  spigotsOf,
  type RangeKind,
} from "../ranges";

const size = (kind: RangeKind, name: string) => RANGE_KINDS[kind].sizeOf(name);

describe("a round size, the way each supplier writes it", () => {
  it.each([
    ["VORTEX FLEXIBLE DUCT R1.0 250mm - 10\"", 250],
    ["DUCT FLEXIBLE PLAIN CORE 350MM X 6M (EA)", 350],
    ["DAI ACC 250 DIA ZONE DAMPER 24V", 250],
    ["'Clip-in' motorised damper 200 dia", 200],
    ["Damper Zone 10\" With 240V Motor", 250],
    ["Damper With 24V Motor 8\"", 200],
    ["Motorised damper 350 insulated", 350],
    ["CONE DIFFUSER PLASTIC 150", 150],
    ["Zone damper Ø250", 250],
  ])("%s is Ø%d", (name, mm) => {
    expect(diameterOf(name)).toBe(mm);
  });

  it("reads no size from a name without one, and never takes an R-value, a voltage or a bag length", () => {
    expect(diameterOf("SUPPLY AIR PLENUM LARGE (EA)")).toBeNull();
    expect(diameterOf("Sonic Drive 240V damper motor")).toBeNull();
  });

  it("takes a diffuser's neck only where the name says it's the neck", () => {
    expect(neckOf("DIRECT VENT MDO 450 X 450 4WAY SA ONLY")).toBeNull();
    expect(neckOf("PLENUM BOX SWIRL DIFFUSER 595X595-200")).toBe(200);
    expect(neckOf("SQUARE DIFFUSER 4 WAY 250MM NECK")).toBe(250);
  });

  it("reads a face", () => {
    expect(faceOf("BAR GRILLE 1055X145mm RC")).toEqual({ w: 1055, h: 145 });
    expect(faceOf("BAR GRILLE 1397 X 147")).toEqual({ w: 1397, h: 147 });
    expect(faceOf("R/A Box Return Air Box 900 X 400 2 X16\"")).toEqual({ w: 900, h: 400 });
  });
});

describe("a Y's or a BTO's sizes", () => {
  it.each([
    ["AIRLOC SMARTFIT Y 14-10-10 INS", [350], [250, 250]],
    ["AIRLOC SMARTFIT Y 12-8-8 INS KEY", [300], [200, 200]],
    ["BTO 250.200.150 INSULATED", [250], [200, 150]],
    ["300 X 250 X 200 BTO METAL (EA)", [300], [250, 200]],
    ["DUCT POLY INSUL BTO 350X300X250MM (EA)", [350], [300, 250]],
    ["Bto 12- 8- 8- 8", [300], [200, 200, 200]],
    ["Bto 14101010", [350], [250, 250, 250]],
    ["Bto 14 12 12", [350], [300, 300]],
    ["Double Branch Take off Plastic Plain 200x150x150x150", [200], [150, 150, 150]],
    ["AIRLOC SMARTFIT Y 18/20-14-14 INS COMBO", [450, 500], [350, 350]],
  ])("%s", (name, ins, outs) => {
    expect(fittingOf(name)).toEqual({ ins, outs });
  });

  it("reads none from a name it can't be sure of", () => {
    expect(fittingOf("BTO 400.400/350.350 INSULATED")).toBeNull();
  });
});

describe("a plenum's spigots", () => {
  it.each([
    ["ACTRON SUPPLY PLENUM 3/350 SPIG", [350, 350, 350]],
    ["ACTRON SUPPLY PLENUM 1/40+2/35 SPIG", [400, 350, 350]],
    ["S/A PLENUM 900 X 350 W/2X350 (EA)", [350, 350]],
    ["S/AIR PLENUM 921 X 304 + 2 X 350 SPIGOT (EA)", [350, 350]],
    ["S/A PLENUM 948 X 290 - 2 X 14\" SPIGOT (EA)", [350, 350]],
    ["295 X 850 S/AIR PLENUM BOX 2 X 350MM (EA)", [350, 350]],
    ["S/A PLENUM 852 X 185 W/ 2 X 350 (EA)", [350, 350]],
  ])("%s", (name, spigots) => {
    expect(spigotsOf(name)).toEqual(spigots);
  });

  it("never takes the plenum's face for a spigot", () => {
    expect(spigotsOf("SUPPLY AIR PLENUM LARGE (EA)")).toBeNull();
  });
});

describe("an isolator and a bracket", () => {
  it.each([
    ["Isolator Switch Surface WP H/ D 20A/ 16AX 250V 2P IP66 Grey", 20, 2],
    ["EUREKA ISOLATOR 32A 1 POLE DNA-W32-1P (EA)", 32, 1],
    ["DOUBLE POLE ISOLATOR SWITCH 35A (EA)", 35, 2],
    ["ISOLATOR 20A DOUBLE POLE- RECTANGLE ENCL (EA)", 20, 2],
    ["WEATHERPROOF ISOLATOR 4 POLE 35 AMPS (EA)", 35, 4],
    ["Isolator Switch Weatherproof 3P 63A 440V", 63, 3],
    ["240V 20A IP66 W/PROOF ISOLATOR LOCKABLE (EA)", 20, null],
  ])("%s", (name, amps, poles) => {
    expect(isolatorOf(name)).toEqual({ amps, poles });
  });

  it("reads what a bracket holds", () => {
    expect(size("wall_bracket", "CON WALL BRACKET 250KG W:550 H:450 L:850")).toEqual({ kg: 250 });
    expect(size("wall_bracket", "450MM ASPEN XTRA WALL BRACKET 100KG (EA)")).toEqual({ kg: 100 });
  });
});

describe("which items a range of each kind is made from", () => {
  it("offers zone dampers, not non-return, fire, manual or volume control dampers, nor a damper's motor", () => {
    expect(inKind("zone_damper", "DAI ACC 250 DIA ZONE DAMPER 24V")).toBe(true);
    expect(inKind("zone_damper", "Damper Zone 10\" With 240V Motor")).toBe(true);
    for (const n of ["NON RETURN DAMPER 100mm", "Back Draft Damper 150mm Dia", "Kilargo Intumescent Fire Damper Single 250 x 250mm", "MANUAL DAMPER 250mm", "VOLUME CONTROL DAMPER 250mm NSW", "Sonic Drive 240V damper motor", "4 Zone Controller 24V damper"]) {
      expect([n, inKind("zone_damper", n)]).toEqual([n, false]);
    }
  });

  it("offers flexible duct, not its straps, saddles or joints, and an isolator, not its stand", () => {
    expect(inKind("flex_duct", "SAFE-T-FLEX INS. DUCT R1.0 250MM X 6M (EA)")).toBe(true);
    expect(inKind("flex_duct", "FLEX-DUCT HANGING STRAP 25mm x 100m")).toBe(false);
    expect(inKind("flex_duct", "KWIK-FLEX FLEXIBLE DUCT HANGING SADDLE (EA)")).toBe(false);
    expect(inKind("isolator", "Isolator Stand")).toBe(false);
  });

  it("offers supply plenums, not return ones or a swirl diffuser's box", () => {
    expect(inKind("plenum", "ACTRON SUPPLY PLENUM 3/350 SPIG")).toBe(true);
    expect(inKind("plenum", "R/A PLENUM 900 X 350 W/2X400 (EA)")).toBe(false);
    expect(inKind("plenum", "PLENUM BOX SWIRL DIFFUSER 595X595-200")).toBe(false);
  });

  it("reads a flexible duct's bag length, when its name gives one", () => {
    expect(size("flex_duct", "DUCT FLEXIBLE PLAIN CORE 250MM X 6M (EA)")).toEqual({ mm: 250, lengthM: 6 });
    expect(size("flex_duct", "VORTEX+ FLEXIBLE DUCT R1.5 400mm - 16\" 3M")).toEqual({ mm: 400, lengthM: 3 });
    expect(size("flex_duct", "VORTEX FLEXIBLE DUCT R1.0 250mm - 10\"")).toEqual({ mm: 250, lengthM: null });
  });

  it("reads a return box's spigots beside its face", () => {
    expect(size("return_grille", "R/A Box Return Air Box 900 X 400 2 X16\"")).toEqual({ w: 900, h: 400, spigots: [400, 400] });
    expect(size("return_grille", "GLOSS RETURN AIR ABS 360 X 360 4 WAY EGGCRATE")).toEqual({ w: 360, h: 360 });
  });
});

describe("one product line, from one item", () => {
  const aad = (name: string) => ({ supplierKey: "aad", name });

  it("keeps a line's sizes together, whatever marks its key sizes, and nobody else's", () => {
    expect(sameLine(aad("AIRLOC SMARTFIT Y 14-10-10 INS"), aad("AIRLOC SMARTFIT Y 14-12-12 INS KEY"))).toBe(true);
    expect(sameLine(aad("AIRLOC SMARTFIT Y 14-10-10 INS"), aad("AIRLOC SMARTFIT Y 18/20-14-14 INS COMBO"))).toBe(true);
    expect(sameLine(aad("BTO 250.150.150 INSULATED"), aad("BTO 150.150.150 PLAIN"))).toBe(false);
    expect(sameLine(aad("MANUAL DAMPER 250mm"), aad("NON RETURN DAMPER 250mm"))).toBe(false);
    expect(sameLine(aad("MANUAL DAMPER 250mm"), { supplierKey: "reece", name: "MANUAL DAMPER 300mm" })).toBe(false);
  });
});

describe("the size a kit line takes", () => {
  const offer = (code: string, size: object, perUnitCents: number) => ({ code, size, perUnitCents });

  it("takes the smallest isolator rated for the outdoor, on its supply when the range says poles", () => {
    const range = [
      offer("2P-20", { amps: 20, poles: 2 }, 1828),
      offer("2P-35", { amps: 35, poles: 2 }, 2828),
      offer("3P-20", { amps: 20, poles: 3 }, 4436),
      offer("3P-63", { amps: 63, poles: 3 }, 3431),
    ];
    expect(pickFromRange("isolator", range, { amps: 16, phase: "1" })?.code).toBe("2P-20");
    expect(pickFromRange("isolator", range, { amps: 28, phase: "1" })?.code).toBe("2P-35");
    expect(pickFromRange("isolator", range, { amps: 16, phase: "3" })?.code).toBe("3P-20");
    expect(pickFromRange("isolator", range, { amps: 40, phase: "1" })).toBeNull();
  });

  it("takes the smallest bracket that holds the outdoor and takes its width (Isaac, 2026-09-30: the 180 kg doesn't fit a PUZ-ZM125)", () => {
    const range = [offer("CWB180", { kg: 180, maxWidthMm: 900 }, 3079), offer("CWBX", { kg: 250 }, 4865)];
    expect(pickFromRange("wall_bracket", range, { kg: 53, w: 840 })?.code).toBe("CWB180");
    expect(pickFromRange("wall_bracket", range, { kg: 114, w: 1050 })?.code).toBe("CWBX");
  });

  it("takes a round size exactly, a face within 10 mm either way round for a return, and a fitting's or plenum's sizes exactly", () => {
    expect(fitOf("zone_damper", { mm: 250 }, { mm: 250 })).toBe(0);
    expect(fitOf("zone_damper", { mm: 300 }, { mm: 250 })).toBeNull();
    expect(fitOf("bar_grille", { w: 1397, h: 147 }, { w: 1400, h: 150 })).toBe(6);
    expect(fitOf("return_grille", { w: 550, h: 900 }, { w: 900, h: 550 })).toBe(1);
    expect(fitOf("fitting", { ins: [350], outs: [250, 300] }, { ins: [350], outs: [300, 250] })).toBe(0);
    expect(fitOf("fitting", { ins: [450, 500], outs: [350, 350] }, { ins: [500], outs: [350, 350] })).toBe(0);
    expect(fitOf("plenum", { spigots: [400, 350, 350] }, { spigots: [350, 400, 350] })).toBe(0);
  });

  it("takes the cheaper of two that fit as well", () => {
    expect(pickFromRange("zone_damper", [offer("A", { mm: 250 }, 4521), offer("B", { mm: 250 }, 3674)], { mm: 250 })?.code).toBe("B");
  });
});

describe("what a kit line needs, read back", () => {
  it("reads the outdoor's current and supply off an isolator, and its size off a bracket", () => {
    expect(rangeNeedOf({ name: "Isolator", sub: `${forTheOutdoorsCurrent(28, "1")}Living` })).toEqual({ kind: "isolator", need: { amps: 28, phase: "1" } });
    expect(rangeNeedOf({ name: "Isolator", sub: `${forTheOutdoorsCurrent(16, null)}the multi` })).toEqual({ kind: "isolator", need: { amps: 16, phase: null } });
    expect(rangeNeedOf({ name: "Isolator, 3Ø 32 A", sub: "Weatherproof IP66" })).toEqual({ kind: "isolator", need: { amps: 32, phase: "3" } });
    expect(rangeNeedOf({ name: "Isolator", sub: "Living" })).toEqual({ kind: "isolator", need: null });
    expect(rangeNeedOf({ name: "Wall bracket", sub: `${forTheOutdoorsSize(1050, 114)}the ducted system` })).toEqual({ kind: "wall_bracket", need: { w: 1050, kg: 114 } });
  });

  it("reads a ducted kit's sizes off its lines' names", () => {
    expect(rangeNeedOf({ name: "Zone damper Ø250", sub: "a zone" })).toEqual({ kind: "zone_damper", need: { mm: 250 } });
    expect(rangeNeedOf({ name: "Trunk Ø350", sub: "" })).toEqual({ kind: "flex_duct", need: { mm: 350 } });
    expect(rangeNeedOf({ name: "Bar grille 1200 × 150, flangeless", sub: "" })).toEqual({ kind: "bar_grille", need: { w: 1200, h: 150 } });
    expect(rangeNeedOf({ name: "Slot diffuser 1200 long", sub: "" })).toEqual({ kind: "slot_diffuser", need: { w: 1200 } });
    expect(rangeNeedOf({ name: "Return grille, Ø250 spigot", sub: "" })).toEqual({ kind: "return_grille", need: { mm: 250 } });
    expect(rangeNeedOf({ name: "Fitting Ø350 → Ø300 / Ø250", sub: "" })).toEqual({ kind: "fitting", need: { ins: [350], outs: [300, 250] } });
    expect(rangeNeedOf({ name: "Plenum, spigots Ø250 / Ø250 / Ø250", sub: "" })).toEqual({ kind: "plenum", need: { spigots: [250, 250, 250] } });
    expect(rangeNeedOf({ name: "Zone damper", sub: "a zone" })).toEqual({ kind: "zone_damper", need: null });
    expect(rangeNeedOf({ name: "Drain hose", sub: "" })).toBeNull();
  });

  it("says a size in a few words", () => {
    expect(sizeWords("isolator", { amps: 20, poles: 2 })).toBe("20 A, 2 pole");
    expect(sizeWords("fitting", { ins: [450, 500], outs: [350, 350] })).toBe("Ø450 or Ø500 → Ø350 / Ø350");
    expect(sizeWords("plenum", { spigots: [350, 400, 350] })).toBe("Ø400 + 2 × Ø350");
    expect(needWords("isolator", { amps: 63, phase: "3" })).toBe("63 A on three phase");
    expect(needWords("wall_bracket", { kg: 114, w: 1050 })).toBe("114 kg, 1050 mm wide");
  });
});

/* the whole book read on 2026-10-06, before Isaac walks his ranges: the
   names the first samples didn't have */
describe("the rest of the book's names", () => {
  it("takes AAD's metal BTOs and double BTOs as fittings, and no fitting with a range of sizes at each end", () => {
    for (const n of ["METAL BTO200.150.150 NSW", "METAL DBTO250.200.200.200 NSW", "DBTO 250.200.150.150 INSULATED", "Y 150.100.100 PLAIN", "300 X 200 X 200 X 200 DBTO METAL (EA)"]) {
      expect([n, inKind("fitting", n)]).toEqual([n, true]);
    }
    expect(fittingOf("METAL BTO200.150.150 NSW")).toEqual({ ins: [200], outs: [150, 150] });
    expect(fittingOf("QUIETFLO FLEXI Y 400 350 300")).toEqual({ ins: [400], outs: [350, 300] });
    expect(fittingOf("DBTO 400-450, 300-350-400, 200-250, 200-250 INS")).toBeNull();
  });

  it("never reads a square face as a round diffuser's size", () => {
    expect(inKind("round_diffuser", "Flush Face Diffuser White 4W 300 x 300")).toBe(false);
    expect(inKind("round_diffuser", "AIRFORM FULLCONE ROUND DIFFUSER 250MM (EA)")).toBe(true);
    expect(size("round_diffuser", "Ventmann Circular Diffuser 250")).toEqual({ mm: 250 });
  });

  it("takes a chevron return, and leaves slotted angle and strut out of slot diffusers", () => {
    expect(inKind("return_grille", "HALF CHEVRON R/A FILTERED HINGED 900X400")).toBe(true);
    expect(size("return_grille", "HALF CHEVRON R/A FILTERED HINGED 900X400")).toEqual({ w: 900, h: 400 });
    expect(inKind("slot_diffuser", "SLOTTED ANGLE 30X30-2.5mm 3M")).toBe(false);
    expect(inKind("slot_diffuser", "STRUT SLOTTED 40X20X2.5 3MTR")).toBe(false);
    expect(inKind("slot_diffuser", "LINEAR 2 SLOT DIFF 1200X97 RC")).toBe(true);
  });

  it("takes a motorised zone damper by its size", () => {
    expect(inKind("zone_damper", "ZONEBOSS PLA MOTOR DAMPER 3NM 24V 250MM (EA)")).toBe(true);
    expect(size("zone_damper", "ZONEBOSS PLA MOTOR DAMPER 3NM 24V 250MM (EA)")).toEqual({ mm: 250 });
  });
});
