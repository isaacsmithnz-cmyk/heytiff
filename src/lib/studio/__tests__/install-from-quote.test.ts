/* Install details answered by the quote (install-from-quote.ts): a quote's
   material lines tick the questions they settle, and leave the rest. The
   names are the kind a supplier's lines carry. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { answerFromQuote, answersFromQuote, pumpsFromQuote, stillQuoted } from "../install-from-quote";
import { createDesign, type DesignDocument, type DesignObject } from "../document";
import { claimZone, newSystem } from "../zones";
import { answerInstall, equipmentList, installAnswers } from "../install";
import { addHead } from "../builder";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import type { RoomObj } from "../loads-room";

const QUOTE = [
  { name: "PAIRED COIL 1/4 + 3/8 X 5M", qty: 1 },
  { name: "ISOLATOR SMALL 2 POLE 20A IP56", qty: 1 },
  { name: "Cable Tps 2.5Mm 2C+E per metre", qty: 10 },
  { name: "CON WALL BRACKET 250KG W:550 H:450 L:850", qty: 1 },
  { name: "DURA FLEX COND DRAIN HOSE (16/18MM) (MTR)", qty: 6 },
  { name: "MINI AQUA CONDENSATE PUMP 14L/HR (EA)", qty: 2 },
  { name: "Plastering allowance", qty: 1 },
];

describe("answers from a quote's lines", () => {
  it("reads the bracket, the drain and pump, the electrical and the controls", () => {
    expect(answersFromQuote(QUOTE)).toEqual({
      "outdoor-sits": ["wall"],
      "wall-bracket": ["heavy-bracket"],
      controls: ["wireless"],
      condensate: ["gravity", "pump"],
      "electrical-work": ["yes"],
    });
  });

  it("says nothing of what the quote doesn't", () => {
    const a = answersFromQuote([{ name: "Consumables", qty: 1 }]);
    expect(a["outdoor-sits"]).toBeUndefined();
    expect(a.condensate).toBeUndefined();
    expect(a["electrical-work"]).toBeUndefined();
    // a quote with no controller still means the remotes each head comes with
    expect(a.controls).toEqual(["wireless"]);
  });

  it("reads a plain bracket, a Wi-Fi adapter and a ground pad", () => {
    expect(answersFromQuote([{ name: "Wall bracket 120kg", qty: 1 }])["wall-bracket"]).toEqual(["wall-bracket"]);
    expect(answersFromQuote([{ name: "MAC-587IF-E Wi-Fi interface", qty: 1 }]).controls).toEqual(["wifi"]);
    expect(answersFromQuote([{ name: "Condenser pad 900 x 450", qty: 1 }])["ground-base"]).toEqual(["ground-pad"]);
  });

  it("answers a system and keeps what the quote said", () => {
    const made = newSystem(createDesign({ name: "house", mode: "blank" }), "2026.1");
    const d = answerFromQuote(made.doc, made.systemId, QUOTE);
    const sys = d.systems.find((s) => s.id === made.systemId)!;
    const answers = installAnswers(d, sys);
    expect(answers["outdoor-sits"]).toEqual(["wall"]);
    expect(answers["wall-bracket"]).toEqual(["heavy-bracket"]);
    expect(answers["electrical-work"]).toEqual(["yes"]);
    const quoted = sys.settings.installQuoted as Record<string, string[]>;
    expect(stillQuoted(quoted["outdoor-sits"], answers["outdoor-sits"])).toBe(true);
    // changed since: no longer the quote's
    expect(stillQuoted(quoted["electrical-work"], ["no"])).toBe(false);
  });
});

/* the live walk's real lines, 21 November 2026: job 3517 was answered by hand
   "ground, rubber feet" and "wired" for these */
describe("the lines a real quote carries", () => {
  it("reads neoprene condenser mounts as the ground on rubber feet", () => {
    const a = answersFromQuote([{ name: "NEOPRENE COND MOUNT ADJUSTABLE NSW", qty: 1 }]);
    expect(a["outdoor-sits"]).toEqual(["ground"]);
    expect(a["ground-base"]).toEqual(["rubber-feet"]);
  });

  it("reads an AirTouch zone control as wired", () => {
    expect(answersFromQuote([{ name: "AirTouch 5 zone control, with five 24 V zone motors", qty: 1 }]).controls).toEqual(["wired"]);
  });

  it("counts the quote's condensate pumps, line by line", () => {
    expect(
      pumpsFromQuote([
        { name: "MINI AQUA CONDENSATE PUMP 14L/HR FP2406 (EA)", qty: 1 },
        { name: "MINI AQUA CONDENSATE PUMP 14L/HR FP2406 (EA)", qty: 1 },
        { name: "DURA FLEX COND DRAIN HOSE(16/18MM) 50MT (MTR)", qty: 6 },
      ])
    ).toBe(2);
  });
});

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

describe("the equipment list counts the quote's pumps", () => {
  const pack = loadPack();
  /** four heads with no pump of their own, the quote two pumps */
  function fourHeads(): { doc: DesignDocument; id: string } {
    const doc = createDesign({ name: "house", mode: "blank" });
    const floorId = doc.floors[0].id;
    const zones = ["living", "bed1", "bed2", "bed3"];
    zones.forEach((id, i) =>
      doc.objects.push({
        id,
        type: "room",
        systemId: null,
        floorId,
        plane: "room",
        geometry: { kind: "polygon", points: [{ x: i * 500, y: 0 }, { x: i * 500 + 400, y: 0 }, { x: i * 500 + 400, y: 300 }, { x: i * 500, y: 300 }] },
        props: { name: id },
      } as RoomObj as DesignObject)
    );
    const made = newSystem(doc, pack.meta.version);
    let d = made.doc;
    for (const z of zones) {
      d = claimZone(d, made.systemId, z);
      d = addHead(d, pack, { systemId: made.systemId, zoneId: z, iduModel: "MSZ-AP25VGD2" });
    }
    return { doc: d, id: made.systemId };
  }
  const pumps = (doc: DesignDocument, id: string) =>
    equipmentList(doc, pack, doc.systems.find((s) => s.id === id)!).rows.filter((r) => /pump/i.test(r.name));

  it("lists two pumps for four heads while the condensate is the quote's", () => {
    const { doc, id } = fourHeads();
    const d = answerFromQuote(doc, id, [
      { name: "MINI AQUA CONDENSATE PUMP 14L/HR FP2406 (EA)", qty: 1 },
      { name: "MINI AQUA CONDENSATE PUMP 14L/HR FP2406 (EA)", qty: 1 },
      { name: "DURA FLEX COND DRAIN HOSE(16/18MM) 50MT (MTR)", qty: 6 },
    ]);
    expect(pumps(d, id).map((r) => r.qty)).toEqual([2]);
    // answered again by hand: a pump a head
    const byHand = answerInstall(d, id, "condensate", ["pump"]);
    expect(pumps(byHand, id).reduce((n, r) => n + (r.qty ?? 0), 0)).toBe(4);
  });
});
