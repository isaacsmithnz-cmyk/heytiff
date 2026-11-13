/* How to design (help-steps.ts; Isaac, 13 November 2026): the eight steps,
   marked off the design, the first unmet one the step you're on. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { createDesign, type DesignObject } from "../document";
import { addBandUnit, allocationsOf, placeAllocation } from "../builder";
import { claimZone, newSystem } from "../zones";
import { helpSteps } from "../help-steps";

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

function rooms() {
  const doc = createDesign({ name: "x", mode: "blank" });
  doc.floors[0] = { ...doc.floors[0], scaleMmPerUnit: 10 };
  for (const [id, x] of [["living", 0], ["bed", 6]] as const)
    doc.objects.push({
      id,
      type: "room",
      systemId: null,
      floorId: doc.floors[0].id,
      plane: "room",
      geometry: { kind: "polygon", points: [{ x: m(x), y: 0 }, { x: m(x + 5), y: 0 }, { x: m(x + 5), y: m(4) }, { x: m(x), y: m(4) }] },
      props: { name: id },
    } as DesignObject);
  return doc;
}

const now = (steps: ReturnType<typeof helpSteps>) => steps.find((s) => s.state === "now")?.title;

describe("How to design", () => {
  it("a new design is on Plans, every other step to come", () => {
    const steps = helpSteps(createDesign({ name: "x", mode: "blank" }), pack);
    expect(steps.map((s) => s.title)).toEqual([
      "Plans", "Scale and north", "Zones", "Add a system", "Add zones", "Build system", "Install details", "Summary",
    ]);
    expect(steps.map((s) => s.state)).toEqual(["now", "todo", "todo", "todo", "todo", "todo", "todo", "todo"]);
  });

  it("walks the ladder: Add a system, Add zones, Build system, then Install details", () => {
    let doc = rooms();
    expect(now(helpSteps(doc, pack))).toBe("Add a system");
    const made = newSystem(doc, pack.meta.version);
    doc = made.doc;
    expect(now(helpSteps(doc, pack))).toBe("Add zones");
    doc = claimZone(claimZone(doc, made.systemId, "living"), made.systemId, "bed");
    expect(now(helpSteps(doc, pack))).toBe("Build system");
    doc = addBandUnit(doc, pack, { systemId: made.systemId, iduModel: "PEAD-M100JAA(D)" });
    /* chosen but not on the plan: still building */
    expect(now(helpSteps(doc, pack))).toBe("Build system");
    /* every unit it chose goes on the plan, the outdoor too */
    allocationsOf(doc.systems[0]).filter((a) => a.model).forEach((a, i) => {
      doc = placeAllocation(doc, pack, made.systemId, a.id, doc.floors[0].id, { x: m(5.5 + i), y: m(2) });
    });
    expect(helpSteps(doc, pack).map((s) => s.state)).toEqual(["done", "done", "done", "done", "done", "done", "now", "todo"]);
    expect(now(helpSteps(doc, pack))).toBe("Install details");
  });

  it("says step 4 is Add system and the family is picked at Build system", () => {
    const steps = helpSteps(rooms(), pack);
    expect(steps[3].line).toBe("Press Add system, once for each system the job needs.");
    expect(steps[5].line).toMatch(/^Pick its family: split, multi, ducted or VRF\. /);
  });
});
