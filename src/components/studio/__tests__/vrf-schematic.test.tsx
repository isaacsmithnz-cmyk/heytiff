/* The Schematic with a riser in place (Isaac, 2026-09-30: "I can't see the
   riser on the schematic anywhere"): the section that climbs it wears a
   marker with its letter and height, and each head says its floor. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { render, screen } from "@testing-library/react";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "@/lib/studio/packs/schema";
import { assemblePack, type PackSource } from "@/lib/studio/packs/loader";
import { createDesign, type DesignDocument, type DesignObject } from "@/lib/studio/document";
import type { RoomObj } from "@/lib/studio/loads-room";
import { allocationsOf } from "@/lib/studio/allocations";
import { addHead, chooseOutdoor } from "@/lib/studio/builder";
import { newSystem } from "@/lib/studio/zones";
import { setRiserHeight } from "@/lib/studio/graph";
import { VrfSchematic } from "../vrf-schematic";

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

function twoFloors(): { doc: DesignDocument; systemId: string } {
  let doc = createDesign({ name: "riser", mode: "blank" });
  const g = doc.floors[0];
  doc = { ...doc, floors: [{ ...g, name: "Ground floor" }, { ...g, id: "flr_up", name: "Level 1", level: 1 }] };
  doc.objects.push({
    id: "z1",
    type: "room",
    systemId: null,
    floorId: "flr_up",
    plane: "room",
    geometry: { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 }] },
    props: { name: "Office" },
  } as RoomObj as DesignObject);
  const made = newSystem(doc, pack.meta.version);
  const systemId = made.systemId;
  doc = made.doc;
  const p40 = pack.indoor_units.find((u) => u.capacity_index === 40 && u.system_roles?.includes("vrf"))!.model;
  doc = addHead(doc, pack, { systemId, zoneId: "z1", iduModel: p40 });
  doc = chooseOutdoor(doc, pack, "worst-of-both", systemId, "PUHY-P200YNW-A1");
  const allocs = allocationsOf(doc.systems.find((s) => s.id === systemId)!);
  const odu = allocs.find((a) => a.role === "odu")!;
  const head = allocs.find((a) => a.role === "idu")!;
  const pt = (id: string, type: string, floorId: string, props: Record<string, unknown>): DesignObject =>
    ({ id, type, systemId, floorId, geometry: { kind: "point", at: { x: 0, y: 0 } }, plane: "room", props }) as DesignObject;
  const run = (id: string, floorId: string, a: [string, string], b: [string, string]): DesignObject =>
    ({
      id,
      type: "pipe-run",
      systemId,
      floorId,
      geometry: { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 500, y: 0 }] },
      plane: "room",
      props: { startAttach: { kind: a[0], id: a[1] }, endAttach: { kind: b[0], id: b[1] } },
    }) as DesignObject;
  doc = {
    ...doc,
    objects: [
      ...doc.objects,
      pt(odu.id, "unit", g.id, { role: "odu", model: odu.model }),
      pt(head.id, "unit", "flr_up", { role: "idu", model: head.model }),
      pt("r0", "riser", g.id, { group: "A" }),
      pt("r1", "riser", "flr_up", { group: "A" }),
      run("p0", g.id, ["unit", odu.id], ["riser", "r0"]),
      run("p1", "flr_up", ["riser", "r1"], ["unit", head.id]),
    ],
  };
  return { doc, systemId };
}

describe("the Schematic with a riser", () => {
  it("marks the riser on its pipe with its letter and height, and each head's floor", () => {
    const { doc, systemId } = twoFloors();
    const sys = doc.systems.find((s) => s.id === systemId)!;
    const { rerender } = render(<VrfSchematic doc={doc} pack={pack} sys={sys} units="in" />);
    expect(screen.getByText("Riser A, 3 m")).toBeTruthy();
    expect(screen.getByText("Level 1, +3 m")).toBeTruthy();
    const tall = setRiserHeight(doc, "r0", 6);
    rerender(<VrfSchematic doc={tall} pack={pack} sys={sys} units="in" />);
    expect(screen.getByText("Riser A, 6 m")).toBeTruthy();
  });
});
