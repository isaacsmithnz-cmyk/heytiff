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
import { riserOnRun } from "@/lib/studio/joints";
import { systemFindings } from "@/lib/studio/verdict";
import { systemVrfTree } from "@/lib/studio/vrf-tree";
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
    // what it is, what it does, and the pipe either side
    expect(screen.getByText("Riser A")).toBeTruthy();
    expect(screen.getByText("3 m up to Level 1")).toBeTruthy();
    expect(screen.getByText("Level 1, +3 m")).toBeTruthy();
    // the pipe before the riser and after it, each on its own stretch, not in the riser's words
    expect(screen.getAllByText("5.0 m")).toHaveLength(2);
    expect(screen.queryByText(/on Level 1/)).toBeNull();
    const tall = setRiserHeight(doc, "r0", 6);
    rerender(<VrfSchematic doc={tall} pack={pack} sys={sys} units="in" />);
    expect(screen.getByText("6 m up to Level 1")).toBeTruthy();
  });
});

describe("floor bands (Isaac, 2026-09-30)", () => {
  it("a system on two floors is laid out a strip per floor, the top floor first, each head in its own", () => {
    const { doc, systemId } = twoFloors();
    const sys = doc.systems.find((s) => s.id === systemId)!;
    const { container } = render(<VrfSchematic doc={doc} pack={pack} sys={sys} units="in" />);
    const bands = [...container.querySelectorAll(".ds-schem-band")];
    expect(bands.map((b) => b.querySelector("text")!.textContent)).toEqual(["Level 1", "Ground floor"]);
    const band = (i: number) => {
      const r = bands[i].querySelector("rect")!;
      return { top: Number(r.getAttribute("y")), bottom: Number(r.getAttribute("y")) + Number(r.getAttribute("height")) };
    };
    // the outdoor in the ground floor's strip, the head in Level 1's
    const y = (sel: string) => Number(container.querySelector(sel)!.getAttribute("y"));
    const odu = y(".ds-schem-odu-n rect");
    const head = y(".ds-schem-head rect");
    expect(odu).toBeGreaterThan(band(1).top);
    expect(odu).toBeLessThan(band(1).bottom);
    expect(head).toBeGreaterThan(band(0).top);
    expect(head).toBeLessThan(band(0).bottom);
  });
});

describe("a riser dropped on the trunk (Isaac, 2026-09-30: it sat on the pipe without joining it)", () => {
  /* the outdoor → a ground-floor head along one run; the riser dropped half
     way along it; upstairs, the riser → the Level 1 head */
  function onTrunk(): { doc: DesignDocument; systemId: string; riser: DesignObject } {
    let doc = createDesign({ name: "trunk riser", mode: "blank" });
    const g = doc.floors[0];
    doc = { ...doc, floors: [{ ...g, name: "Ground floor" }, { ...g, id: "flr_up", name: "Level 1", level: 1 }] };
    const room = (id: string, floorId: string) =>
      doc.objects.push({
        id,
        type: "room",
        systemId: null,
        floorId,
        plane: "room",
        geometry: { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 }] },
        props: { name: id },
      } as RoomObj as DesignObject);
    room("Down", g.id);
    room("Up", "flr_up");
    const made = newSystem(doc, pack.meta.version);
    const systemId = made.systemId;
    doc = made.doc;
    const p40 = pack.indoor_units.find((u) => u.capacity_index === 40 && u.system_roles?.includes("vrf"))!.model;
    doc = addHead(doc, pack, { systemId, zoneId: "Down", iduModel: p40 });
    doc = addHead(doc, pack, { systemId, zoneId: "Up", iduModel: p40 });
    doc = chooseOutdoor(doc, pack, "worst-of-both", systemId, "PUHY-P200YNW-A1");
    const allocs = allocationsOf(doc.systems.find((s) => s.id === systemId)!);
    const odu = allocs.find((a) => a.role === "odu")!;
    const [down, up] = allocs.filter((a) => a.role === "idu");
    const pt = (id: string, type: string, floorId: string, x: number, props: Record<string, unknown>): DesignObject =>
      ({ id, type, systemId, floorId, geometry: { kind: "point", at: { x, y: 0 } }, plane: "room", props }) as DesignObject;
    const run = (id: string, floorId: string, x0: number, x1: number, a: [string, string], b: [string, string]): DesignObject =>
      ({
        id,
        type: "pipe-run",
        systemId,
        floorId,
        geometry: { kind: "polyline", points: [{ x: x0, y: 0 }, { x: x1, y: 0 }] },
        plane: "room",
        props: { startAttach: { kind: a[0], id: a[1] }, endAttach: { kind: b[0], id: b[1] } },
      }) as DesignObject;
    const riser = pt("r0", "riser", g.id, 500, { group: "A" });
    doc = {
      ...doc,
      objects: [
        ...doc.objects,
        pt(odu.id, "unit", g.id, 0, { role: "odu", model: odu.model }),
        pt(down.id, "unit", g.id, 1000, { role: "idu", model: down.model }),
        pt(up.id, "unit", "flr_up", 1000, { role: "idu", model: up.model }),
        pt("r1", "riser", "flr_up", 500, { group: "A" }),
        run("trunk", g.id, 0, 1000, ["unit", odu.id], ["unit", down.id]),
        run("up", "flr_up", 500, 1000, ["riser", "r1"], ["unit", up.id]),
      ],
    };
    return { doc, systemId, riser };
  }

  it("sitting on the pipe unjoined, it is red and the floor above is not piped", () => {
    const t = onTrunk();
    const doc = { ...t.doc, objects: [...t.doc.objects, t.riser] };
    const sys = doc.systems.find((s) => s.id === t.systemId)!;
    expect(systemFindings(doc, pack, sys).map((f) => f.code)).toContain("stray-riser");
    render(<VrfSchematic doc={doc} pack={pack} sys={sys} units="in" />);
    expect(screen.getByText("Riser A has no pipe on Ground floor")).toBeTruthy();
    expect(screen.getByText("Not piped to the outdoor yet: Up")).toBeTruthy();
  });

  it("dropped in the pipe, it joins it: a joint at its foot, and the floor above is drawn", () => {
    const t = onTrunk();
    const doc = riserOnRun(t.doc, "trunk", 0, t.riser, 1)!;
    const sys = doc.systems.find((s) => s.id === t.systemId)!;
    expect(systemFindings(doc, pack, sys).map((f) => f.code)).not.toContain("stray-riser");
    const tree = systemVrfTree(pack, sys, doc)!;
    expect(tree.drawn).toBe(true);
    expect(tree.fittings.map((f) => f.nodeId)).toEqual(["r0"]);
    render(<VrfSchematic doc={doc} pack={pack} sys={sys} units="in" />);
    expect(screen.getByText("3 m up to Level 1")).toBeTruthy();
  });
});
