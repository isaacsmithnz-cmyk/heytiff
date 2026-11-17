import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { createDesign, type DesignDocument, type DesignObject } from "../document";
import { runPipeMm, sizeTone } from "../pipe-sizes";

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

const unit = (id: string, model: string, role: "idu" | "odu"): DesignObject =>
  ({ id, type: "unit", floorId: "gf", systemId: "s1", geometry: { kind: "point", at: { x: 0, y: 0 } }, props: { model, role } }) as DesignObject;
const run = (id: string, to: string, props: Record<string, unknown> = {}): DesignObject =>
  ({
    id,
    type: "pipe-run",
    floorId: "gf",
    systemId: "s1",
    geometry: { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
    props: { startAttach: { kind: "unit", id: "odu" }, endAttach: { kind: "unit", id: to }, ...props },
  }) as DesignObject;

/* 3516's multi: an MXZ-4F71VGD with the living room's AP50 and a bedroom's AP25 */
function multi(): DesignDocument {
  const d = createDesign({ name: "Waitara", mode: "plan" });
  return {
    ...d,
    systems: [{ id: "s1", name: "System 1", type: "multi", brand: "mitsubishi-electric", colour: "#15803D", settings: {} } as unknown as DesignDocument["systems"][number]],
    objects: [unit("odu", "MXZ-4F71VGD", "odu"), unit("liv", "MSZ-AP50VGD2", "idu"), unit("bed", "MSZ-AP25VGD2", "idu"), run("r1", "liv"), run("r2", "bed")],
  };
}

describe("a multi's runs, by size", () => {
  test("each run is the head at its end", () => {
    const d = multi();
    const ap50 = pack.indoor_units.find((u) => u.model === "MSZ-AP50VGD2")!;
    const ap25 = pack.indoor_units.find((u) => u.model === "MSZ-AP25VGD2")!;
    expect(runPipeMm(d, pack, d.objects[3])).toEqual({ liquidMm: ap50.conn_liquid_mm, gasMm: ap50.conn_gas_mm });
    expect(runPipeMm(d, pack, d.objects[4])).toEqual({ liquidMm: ap25.conn_liquid_mm, gasMm: ap25.conn_gas_mm });
  });

  test("the bigger head's run wears a bigger size's colour", () => {
    const d = multi();
    expect(sizeTone(runPipeMm(d, pack, d.objects[3])!.gasMm)).toBeGreaterThan(sizeTone(runPipeMm(d, pack, d.objects[4])!.gasMm));
  });

  test("a size set on the run wins", () => {
    const d = multi();
    expect(runPipeMm(d, pack, run("r3", "bed", { liquidMm: 9.52, gasMm: 15.88 }))).toEqual({ liquidMm: 9.52, gasMm: 15.88 });
  });
});
