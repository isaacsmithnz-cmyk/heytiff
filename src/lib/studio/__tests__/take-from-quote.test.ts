/* What the design takes from the quote (take-from-quote.ts): on the
   Mitsubishi book, a multi made from the quote (from-quote.ts), then the
   quote's answers taken into it. The address is made up. */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { createDesign, type DesignDocument, type DesignObject } from "../document";
import { addQuotedOption, quotedOptions, type QuotedLine } from "../from-quote";
import { allocationsOf } from "../builder";
import { takeFromQuote, tookWords } from "../take-from-quote";

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
  }) as unknown as DesignObject;

function house(): DesignDocument {
  const d = createDesign({ name: "1 Example Street", mode: "plan" });
  return {
    ...d,
    floors: [{ id: "gf", name: "Ground floor", level: 0, scaleMmPerUnit: 15, northDeg: 0, northPos: null, plans: [] }],
    objects: [room("liv", "LIVING", 0), room("mb", "MASTER BED", 400), room("b2", "BED 2", 800), room("b3", "BED 3", 1200)],
  };
}
const line = (system: string, name: string, code: string): QuotedLine => ({ optionIndex: 0, system, name, code, kind: "unit", qty: 1 });

/* the design with a multi of three heads, as the quote's option would make it */
function withMulti() {
  const [o] = quotedOptions(house(), pack, [line("", "Outdoor unit", "MXZ-4F80VGD-A2"), line("Living", "Indoor unit, Living", "MSZ-AP50VGKD2-A2"), line("Master bed", "Indoor unit, Master bed", "MSZ-AP25VGKD2-A2")], []);
  const { doc, systemId } = addQuotedOption(house(), pack, house().settings.sizingBasis, o!);
  return { doc, sys: doc.systems.find((s) => s.id === systemId)! };
}

test("a head the design has takes the quote's model", () => {
  const { doc, sys } = withMulti();
  const head = allocationsOf(sys).find((a) => a.role === "idu" && a.roomId === "mb")!;
  const took = takeFromQuote(doc, pack, [{ lineId: "l1", take: "MSZ-AP35VGD2", units: [head.id], system: null, room: "" }], []);
  const after = allocationsOf(took.doc.systems.find((s) => s.id === sys.id)!).find((a) => a.id === head.id)!;
  expect(after.model).toBe("MSZ-AP35VGD2");
  expect(took.lineIds).toEqual(["l1"]);
  expect(tookWords(took)).toBe("The design took the quote's: MASTER BED MSZ-AP35VGD2");
});

test("a head the quote has goes on the system in the room it names, and a unit said to go comes out", () => {
  const { doc, sys } = withMulti();
  const living = allocationsOf(sys).find((a) => a.role === "idu" && a.roomId === "liv")!;
  const took = takeFromQuote(doc, pack, [{ lineId: "l2", take: "MSZ-AP25VGD2", units: [], system: sys.id, room: "Bed 2" }], [living.id]);
  const allocs = allocationsOf(took.doc.systems.find((s) => s.id === sys.id)!);
  expect(allocs.some((a) => a.id === living.id)).toBe(false);
  expect(allocs.filter((a) => a.role === "idu").map((a) => [a.roomId, a.model])).toEqual([
    ["mb", "MSZ-AP25VGD2"],
    ["b2", "MSZ-AP25VGD2"],
  ]);
  expect(took.dropped).toEqual([living.id]);
  expect(took.words).toEqual(["LIVING out", "BED 2 MSZ-AP25VGD2"]);
});

test("a system the design hadn't got is made from the quote's units", () => {
  const took = takeFromQuote(
    house(),
    pack,
    [
      { lineId: "o", take: "MUZ-AP42VG2", units: [], system: "new:Studio", room: "" },
      { lineId: "h", take: "MSZ-AP42VGD2", units: [], system: "new:Studio", room: "Bed 3" },
    ],
    []
  );
  expect(took.doc.systems).toHaveLength(1);
  expect(took.doc.systems[0]!.name).toBe("Studio");
  expect(allocationsOf(took.doc.systems[0]!).map((a) => a.model).sort()).toEqual(["MSZ-AP42VGD2", "MUZ-AP42VG2"]);
  expect(took.lineIds).toEqual(["o", "h"]);
});

test("what can't be taken waits: no room on the plan, a model the book hasn't got", () => {
  const { doc, sys } = withMulti();
  const took = takeFromQuote(
    doc,
    pack,
    [
      { lineId: "a", take: "MSZ-AP25VGD2", units: [], system: sys.id, room: "Garage" },
      { lineId: "b", take: "NOT-A-MODEL", units: [], system: sys.id, room: "Bed 2" },
    ],
    []
  );
  expect(took.lineIds).toEqual([]);
  expect(took.words).toEqual([]);
  expect(took.doc).toBe(doc);
});
