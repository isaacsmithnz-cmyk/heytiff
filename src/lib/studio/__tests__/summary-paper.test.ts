/* The next flow's document as the model says it (summary-paper.ts): every word
   and figure comes off what buildSummaryModel already worked out, plus the air,
   the grilles and the For column. The house is duct-materials.test.ts's: a
   PEAD-M100JAA(D) serving four rooms, off the real Mitsubishi pack. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { createDesign, newId, type DesignDocument, type DesignObject, type Point } from "../document";
import { addBandUnit, allocationsOf, placeAllocation } from "../builder";
import { claimZone, newSystem } from "../zones";
import { grille } from "../grilles";
import { createNote } from "../notes";
import { device } from "../devices";
import { setZoning } from "../zoning";
import { systemAir } from "../airflow";
import { grilleRoomId } from "../duct-materials";
import { buildSummaryModel, designBasis } from "../summary";
import { floorPlace, joinWords, type SheetPaper } from "../summary-paper";

const SEED_DIR = join(__dirname, "../../../../data/packs/mitsubishi-electric@2026.1");
function loadPack(): DataPack {
  const meta = JSON.parse(readFileSync(join(SEED_DIR, "meta.json"), "utf8")) as PackMeta;
  const sections: PackSource["sections"] = {};
  for (const s of PACK_SECTIONS) {
    const f = join(SEED_DIR, `${s}.json`);
    if (existsSync(f)) sections[s] = JSON.parse(readFileSync(f, "utf8"));
  }
  return assemblePack({ meta, sections });
}
const pack = loadPack();
const m = (v: number) => v * 100;

function house(placed = true): DesignDocument {
  const doc = createDesign({ name: "12 Example St", mode: "blank" });
  doc.floors[0] = { ...doc.floors[0], scaleMmPerUnit: 10 };
  const room = (id: string, name: string, x: number, y: number, w: number, h: number) =>
    doc.objects.push({
      id,
      type: "room",
      systemId: null,
      floorId: doc.floors[0].id,
      plane: "room",
      geometry: {
        kind: "polygon",
        points: [
          { x: m(x), y: m(y) },
          { x: m(x + w), y: m(y) },
          { x: m(x + w), y: m(y + h) },
          { x: m(x), y: m(y + h) },
        ],
      },
      props: { name },
    } as DesignObject);
  room("living", "Living", 0, 0, 7, 5.5);
  room("kitchen", "Kitchen", 7, 0, 5, 5.5);
  room("master", "Master", 0, 5.5, 4, 4.5);
  room("bed2", "Bed 2", 4, 7, 4, 3);
  const made = newSystem(doc, pack.meta.version);
  let d = made.doc;
  for (const z of ["living", "kitchen", "master", "bed2"]) d = claimZone(d, made.systemId, z);
  d = addBandUnit(d, pack, { systemId: made.systemId, iduModel: "PEAD-M100JAA(D)" });
  if (!placed) return d;
  const unit = allocationsOf(d.systems[0]).find((a) => a.role === "idu")!;
  return placeAllocation(d, pack, made.systemId, unit.id, d.floors[0].id, { x: m(6), y: m(6.25) });
}

const put = (d: DesignDocument, o: DesignObject): DesignDocument => ({ ...d, objects: [...d.objects, o] });
const paperOf = (d: DesignDocument): SheetPaper => buildSummaryModel(d, pack).paper!;
const inGroup = (p: SheetPaper, g: string) => p.materials.filter((r) => r.group === g);

describe("the figures", () => {
  it("are the snapshot's, the systems' and the basis's own", () => {
    const d = house();
    const model = buildSummaryModel(d, pack);
    const f = model.paper!.figures;
    expect(f.installedKw).toBe(model.systems[0].capacityKw);
    expect(f.installedLine).toBe("1 system");
    expect(f.loadLine).toMatch(/^4 rooms, \d+ m²$/);
    const b = designBasis(d);
    expect(f.climate).toBe(`Zone ${b.zone}`);
    expect(f.climateLine).toBe(`${b.zoneCity}, residential`);
  });

  it("says what the sizing basis does, which is the smaller of the two ratings", () => {
    const d = house();
    d.settings.sizingBasis = "worst-of-both";
    const f = paperOf(d).figures;
    expect(f.sizedOn).toBe("Heat and cool");
    expect(f.sizedOnLine).toMatch(/smaller/);
    d.settings.sizingBasis = "heating";
    expect(paperOf(d).figures.installedLabel).toBe("Heating installed");
  });

  it("does not let a partial total read as the whole job", () => {
    const d = house();
    d.floors = [{ ...d.floors[0], scaleMmPerUnit: null }];
    expect(paperOf(d).figures.loadLine).toBe("0 of 4 rooms measured");
    expect(paperOf(d).figures.loadKw).toBeNull();
  });
});

describe("a system's block", () => {
  it("has a plain heading, one line of description and its state in words", () => {
    const s = paperOf(house()).systems[0];
    const model = buildSummaryModel(house(), pack).systems[0];
    expect(s.heading).toBe(`${model.name}, ducted`);
    expect(s.description).toContain("Mitsubishi Electric");
    expect(s.description).toContain("PEAD-M100JAA(D) with ");
    expect(s.description).not.toMatch(/·/);
    expect(s.stateWord).toMatch(/^(Covered|\d+\.\d kW short)$/);
    expect(s.stateTone).toBe(s.stateWord === "Covered" ? "ok" : "look");
  });

  it("a short system says by how much, the figure the sheet shows", () => {
    const d = house();
    const model = buildSummaryModel(d, pack).systems[0];
    if (model.status === "under") {
      const short = Math.round((model.loadKw! - model.capacityKw!) * 10) / 10;
      expect(paperOf(d).systems[0].stateWord).toBe(`${short.toFixed(1)} kW short`);
    }
  });

  it("a system nothing is sized on says so in words, in grey", () => {
    const d = createDesign({ name: "Blank", mode: "blank" });
    const made = newSystem(d, pack.meta.version);
    const s = paperOf(made.doc).systems[0];
    expect(s.stateWord).toBe("Not sized yet");
    expect(s.stateTone).toBe("info");
  });

  it("a ducted room reads its air from the unit and its grilles from what was placed", () => {
    let d = house();
    const sys = d.systems[0];
    const f = d.floors[0].id;
    d = put(d, grille(f, sys.id, { x: m(2), y: m(2) }, "supply", { wMm: 600, hMm: 100 }, 0, { style: "linear", mount: "wall" }));
    d = put(d, grille(f, sys.id, { x: m(3), y: m(2) }, "supply", { wMm: 600, hMm: 100 }, 0, { style: "linear", mount: "wall" }));
    d = put(d, grille(f, sys.id, { x: m(4), y: m(2) }, "return", { wMm: 750, hMm: 400 }));
    const s = paperOf(d).systems[0];
    expect(s.form).toBe("air");
    const living = s.rooms.find((r) => r.name === "Living")!;
    expect(living.grilles).toBe("2 wall, linear bar grille 600 × 100");
    /* none placed is none: the sizing rule's outlets are not parts on the job */
    expect(s.rooms.find((r) => r.name === "Kitchen")!.grilles).toBeNull();
    const air = systemAir(d, pack, d.systems[0])[0].rooms.find((r) => r.name === "Living")!;
    expect(living.airLs).toBe(Math.round(air.ls));
  });

  it("a grille drawn on the wall belongs to the room whose wall it is", () => {
    const d = house();
    const onWall = grille(d.floors[0].id, d.systems[0].id, { x: m(-0.1), y: m(2) }, "supply", { wMm: 600, hMm: 100 }, 0, { mount: "wall" });
    expect(grilleRoomId(d, onWall)).toBe("living");
    const away = grille(d.floors[0].id, d.systems[0].id, { x: m(-3), y: m(2) }, "supply", { wMm: 600, hMm: 100 });
    expect(grilleRoomId(d, away)).toBeNull();
  });

  it("says how it is zoned, and where the controller went when somebody put it", () => {
    let d = house();
    const sys = d.systems[0];
    const unit = allocationsOf(sys).find((a) => a.role === "idu")!;
    expect(paperOf(d).systems[0].zoning).toBeNull();
    d = setZoning(d, sys.id, unit.id, { control: "temperature", sensors: "wireless" });
    expect(paperOf(d).systems[0].zoning).toBe("Zoned by temperature: 4 zones, a wireless sensor in each.");
    d = put(d, device(d.floors[0].id, sys.id, { x: m(9), y: m(2) }, "wall-controller"));
    expect(paperOf(d).systems[0].zoning).toBe("Zoned by temperature: 4 zones, a wireless sensor in each, the controller on the Kitchen wall.");
    d = setZoning(d, sys.id, unit.id, { control: "on_off" });
    expect(paperOf(d).systems[0].zoning).toBe("Zoned on and off: 4 zones, the controller on the Kitchen wall.");
  });
});

describe("Materials", () => {
  it("counts every unit the picklist counts", () => {
    const d = house();
    const model = buildSummaryModel(d, pack);
    const paper = inGroup(model.paper!, "units").reduce((n, r) => n + Number(r.qty), 0);
    const pick = model.picklist.filter((r) => r.group === "units").reduce((n, r) => n + Number(r.qty), 0);
    expect(paper).toBe(pick);
    expect(paper).toBeGreaterThan(1);
  });

  it("names a unit, what it is and who it is for", () => {
    const units = inGroup(paperOf(house()), "units");
    expect(units[0].item).toMatch(/outdoor unit, \d+\.\d kW$/);
    expect(units.find((r) => r.item.startsWith("PEAD-M100JAA(D)"))!.item).toMatch(/indoor unit, \d+\.\d kW$/);
  });

  it("says a coil that isn't drawn is not drawn yet, a word and no figure", () => {
    const coil = inGroup(paperOf(house()), "pipework").find((r) => r.item.endsWith("pair coil"))!;
    expect(coil).toMatchObject({ qty: "Not drawn yet", pending: true });
  });

  it("does not put that coil on the pick: the sheet says it, the van doesn't load it", () => {
    const model = buildSummaryModel(house(), pack);
    expect(model.picklist.some((r) => r.group === "pipe")).toBe(false);
  });

  it("renders the line duct-materials gives, with the rooms it went in", () => {
    let d = house();
    const sys = d.systems[0].id;
    const f = d.floors[0].id;
    d = put(d, grille(f, sys, { x: m(2), y: m(2) }, "supply", { wMm: 1200, hMm: 100 }, 0, { style: "linear", mount: "floor" }));
    d = put(d, grille(f, sys, { x: m(2), y: m(7) }, "supply", { wMm: 1200, hMm: 100 }, 0, { style: "linear", mount: "floor" }));
    d = put(d, grille(f, sys, { x: m(9), y: m(2) }, "supply", { wMm: 300, hMm: 300 }));
    const rows = inGroup(paperOf(d), "grilles");
    const linear = rows.find((r) => r.item.startsWith("Linear bar grille 1200 × 100"))!;
    expect(linear).toMatchObject({ item: "Linear bar grille 1200 × 100, supply outlet, floor", forWhat: "Living and Master", qty: "2" });
    expect(rows.find((r) => r.item.startsWith("Square diffuser"))!.forWhat).toBe("Kitchen");
  });

  it("a combined grille takes its own line's words, in the room and on the list", () => {
    let d = house();
    const g = grille(d.floors[0].id, d.systems[0].id, { x: m(2), y: m(2) }, "supply", { wMm: 2400, hMm: 100 }, 0, { style: "linear", mount: "wall" });
    d = put(d, { ...g, props: { ...g.props, supplyMm: 1200 } } as DesignObject);
    const p = paperOf(d);
    const row = inGroup(p, "grilles")[0];
    expect(row.item).toContain("Supply and return".toLowerCase());
    expect(row.item).toContain("Linear grille 2400 × 100, supply 1200 and return 1200");
    expect(p.systems[0].rooms.find((r) => r.name === "Living")!.grilles).toContain("linear grille 2400 × 100");
  });

  it("drops what only told the person drawing, and says unmeasured in the quantity", () => {
    let d = house();
    const run = (floorId: string) =>
      ({
        id: newId("obj"),
        type: "duct-run",
        systemId: d.systems[0].id,
        floorId,
        plane: "ceiling-cavity",
        geometry: { kind: "polyline", points: [{ x: 0, y: 0 }, { x: m(3), y: 0 }] as Point[] },
        props: { diaMm: 250, stream: "supply" },
      }) as DesignObject;
    d = put(d, run(d.floors[0].id));
    expect(inGroup(paperOf(d), "ductwork")[0]).toMatchObject({ item: "Flexible duct Ø250, supply", qty: "3 m", pending: false });
    d = { ...d, floors: [{ ...d.floors[0], scaleMmPerUnit: null }] };
    expect(inGroup(paperOf(d), "ductwork")[0]).toMatchObject({ item: "Flexible duct Ø250", qty: "Not measured yet", pending: true });
  });

  it("puts the groups in the board's order", () => {
    let d = house();
    const sys = d.systems[0];
    const unit = allocationsOf(sys).find((a) => a.role === "idu")!;
    d = setZoning(d, sys.id, unit.id, { control: "temperature" });
    d = put(d, grille(d.floors[0].id, sys.id, { x: m(2), y: m(2) }, "supply", { wMm: 300, hMm: 300 }));
    const seen = [...new Set(paperOf(d).materials.map((r) => r.group))];
    const board = ["units", "pipework", "ductwork", "grilles", "zoning", "electrical", "components"];
    expect(seen).toEqual(board.filter((g) => seen.includes(g as never)));
    /* a damper is on the zoning shelf of the page, wherever the pick shelves it */
    expect(inGroup(paperOf(d), "zoning").some((r) => r.item.startsWith("Zone damper"))).toBe(true);
  });
});

describe("the notes on the plans", () => {
  it("are the person's own words and the floor they are on, lowest floor first", () => {
    let d = house();
    const upper = { ...d.floors[0], id: "up", name: "First", level: 1 };
    d = { ...d, floors: [upper, d.floors[0]] };
    const note = (floorId: string, text: string) =>
      createNote({ floorId, rect: { x: 0, y: 0, w: 1, h: 1 }, leader: { x: 2, y: 2 }, text });
    d = put(d, note("up", "Supply grille from ducted TBC"));
    d = put(d, note(d.floors[1].id, "Riser location\nfor the study duct."));
    d = put(d, note(d.floors[1].id, "   "));
    expect(paperOf(d).notes).toEqual([
      `Riser location for the study duct. ${floorPlace(d.floors[1].name)}.`,
      "Supply grille from ducted TBC. First floor.",
    ]);
  });
});

it("joins a list the way a sentence does", () => {
  expect(joinWords(["A"])).toBe("A");
  expect(joinWords(["A", "B"])).toBe("A and B");
  expect(joinWords(["A", "B", "C"])).toBe("A, B and C");
  expect(floorPlace("Ground")).toBe("Ground floor");
  expect(floorPlace("Ground floor")).toBe("Ground floor");
  expect(floorPlace("Level 2")).toBe("Level 2");
});
