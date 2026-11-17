import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { createDesign, type DesignDocument, type DesignObject } from "../document";
import { addQuotedOption, canAdd, modelForCode, quotedOptions, type QuotedLine } from "../from-quote";
import { allocationsOf } from "../builder";

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

const room = (id: string, name: string, x: number): DesignObject =>
  ({
    id,
    type: "room",
    floorId: "gf",
    systemId: null,
    geometry: { kind: "polygon", points: [{ x, y: 0 }, { x: x + 300, y: 0 }, { x: x + 300, y: 300 }, { x, y: 300 }] },
    props: { name },
  }) as DesignObject;

/* 3516's plan and quote, 17 November 2026 */
function waitara(): DesignDocument {
  const d = createDesign({ name: "12/8-10 Park Ave", mode: "plan" });
  return {
    ...d,
    floors: [{ id: "gf", name: "Ground floor", level: 0, scaleMmPerUnit: 15, northDeg: 0, northPos: null, plans: [] }],
    objects: [
      room("liv", "LIVING / DINING / KITCHEN / STUDY NOOK / ENTRY", 0),
      room("mb", "MASTER BED", 400),
      room("robe2", "ROBE (Bed 2)", 800),
      room("b2", "BED 2", 1200),
      room("b3", "BED 3", 1600),
    ],
  };
}
const line = (optionIndex: number, system: string, name: string, code: string): QuotedLine => ({ optionIndex, system, name, code, kind: "unit", qty: 1 });
const QUOTE: QuotedLine[] = [
  line(0, "", "Outdoor unit", "MXZ-4F80VGD-A2"),
  line(0, "Living", "Indoor unit, Living", "MSZ-AP50VGKD2-A2"),
  line(0, "Master bed", "Indoor unit, Master bed", "MSZ-AP25VGKD2-A2"),
  line(0, "Bed 2", "Indoor unit, Bed 2", "MSZ-AP25VGKD2-A2"),
  line(0, "Bed 3", "Indoor unit, Bed 3", "MSZ-AP25VGKD2-A2"),
  line(1, "", "Outdoor unit", "MXZ-5F100VGD-A2"),
  line(1, "Living", "Indoor unit, Living", "MSZ-AP50VGKD2-A2"),
];

describe("the quote's codes as the book's models", () => {
  test("a supplier's code is the model it carries", () => {
    const idus = pack.indoor_units.map((u) => u.model);
    expect(modelForCode(idus, "MSZ-AP50VGKD2-A2")).toBe("MSZ-AP50VGD2");
    expect(modelForCode(pack.outdoor_units.map((u) => u.model), "MXZ-4F80VGD-A2")).toBe("MXZ-4F80VGD");
    expect(modelForCode(idus, "MSZ-AP60VGKD2-A2")).not.toBe("MSZ-AP50VGD2");
  });
});

describe("From the quote", () => {
  test("each option's units, every head against its room, never the robe", () => {
    const [one, two] = quotedOptions(waitara(), pack, QUOTE, [0]);
    expect(one).toMatchObject({ name: "Option 1", accepted: true, kind: "multi", outdoor: { model: "MXZ-4F80VGD" } });
    expect(one.heads.map((h) => [h.room, h.model, h.roomId])).toEqual([
      ["Living", "MSZ-AP50VGD2", "liv"],
      ["Master bed", "MSZ-AP25VGD2", "mb"],
      ["Bed 2", "MSZ-AP25VGD2", "b2"],
      ["Bed 3", "MSZ-AP25VGD2", "b3"],
    ]);
    expect(two).toMatchObject({ name: "Option 2", accepted: false, outdoor: { model: "MXZ-5F100VGD" } });
  });

  test("Add to design makes the multi on the quoted outdoor, named as the quote names it", () => {
    const d = waitara();
    const [one] = quotedOptions(d, pack, QUOTE, [0]);
    expect(canAdd(one)).toBe(true);
    const out = addQuotedOption(d, pack, "worst-of-both", one);
    const sys = out.doc.systems.find((s) => s.id === out.systemId)!;
    expect(sys.name).toBe("Option 1");
    expect(sys.type).toBe("multi-split");
    expect(allocationsOf(sys).map((a) => [a.role, a.model, a.roomId])).toEqual(
      expect.arrayContaining([
        ["odu", "MXZ-4F80VGD", null],
        ["idu", "MSZ-AP50VGD2", "liv"],
        ["idu", "MSZ-AP25VGD2", "mb"],
        ["idu", "MSZ-AP25VGD2", "b2"],
        ["idu", "MSZ-AP25VGD2", "b3"],
      ]),
    );
  });

  test("a head with no room to go in is said, and left off", () => {
    const d = { ...waitara(), objects: waitara().objects.filter((o) => o.id !== "b3") };
    const [one] = quotedOptions(d, pack, QUOTE, []);
    expect(one.heads[3]).toMatchObject({ room: "Bed 3", roomId: null });
    const sys = addQuotedOption(d, pack, "worst-of-both", one).doc.systems[0];
    expect(allocationsOf(sys).filter((a) => a.role === "idu")).toHaveLength(3);
  });
});
