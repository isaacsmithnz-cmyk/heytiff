/* THE BRAND IS THE PERSON'S CHOICE (Isaac, 20 November 2026, on the Studio
   panel: "by default always selects Mitsubishi Electric. That shouldn't be on
   there"). A system starts with no brand; it takes the brand chosen in the
   builder before its first unit, or the brand of the unit it was made with
   (a quote's option, a unit dropped on a room); the Studio offers it only its
   brand's units, and the plan reads every brand the design names as one
   pack. A saved design keeps its brand. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { SystemBuilder } from "../system-builder";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "@/lib/studio/packs/schema";
import { assemblePack, type PackSource } from "@/lib/studio/packs/loader";
import { createDesign, type DesignDocument, type DesignObject } from "@/lib/studio/document";
import { addHead, addMultiHead, addSplit, allocationsOf } from "@/lib/studio/builder";
import { chooseBrand, claimZone, newSystem } from "@/lib/studio/zones";
import { brandOnly, designBrands, joinPacks, NO_PACK } from "@/lib/studio/packs/merge";

function loadPack(brand: string): DataPack {
  const dir = join(__dirname, `../../../../data/packs/${brand}@2026.1`);
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as PackMeta;
  const sections: PackSource["sections"] = {};
  for (const s of PACK_SECTIONS) {
    const f = join(dir, `${s}.json`);
    if (existsSync(f)) sections[s] = JSON.parse(readFileSync(f, "utf8"));
  }
  return assemblePack({ meta, sections });
}
const me = loadPack("mitsubishi-electric");
const daikin = loadPack("daikin");
const packs: Record<string, DataPack> = { "mitsubishi-electric": me, daikin };
const BRANDS = [
  { id: "daikin", name: "Daikin" },
  { id: "mitsubishi-electric", name: "Mitsubishi Electric" },
];

function house(): DesignDocument {
  const doc = createDesign({ name: "house", mode: "blank" });
  const floorId = doc.floors[0].id;
  const room = (id: string, name: string, x: number, w: number, h: number) =>
    doc.objects.push({
      id,
      type: "room",
      systemId: null,
      floorId,
      plane: "room",
      geometry: { kind: "polygon", points: [{ x, y: 0 }, { x: x + w, y: 0 }, { x: x + w, y: h }, { x, y: h }] },
      props: { name },
    } as DesignObject);
  room("living", "Living", 0, 1000, 960);
  room("bed1", "Bed 1", 1100, 400, 300);
  return doc;
}

/** a wall head the brand's book pairs with an outdoor */
const wall = (p: DataPack) => p.indoor_units.find((u) => u.form_factor === "wall" && p.pair_tables.some((t) => t.idu_model === u.model))!;
const pairFor = (p: DataPack, idu: string) => p.pair_tables.find((t) => t.idu_model === idu)!.odu_model;

describe("a system's brand", () => {
  it("is none until someone chooses one, and pins nothing", () => {
    const made = newSystem(house(), "2026.1");
    const sys = made.doc.systems[0];
    expect(sys.brand).toBe("");
    expect(made.doc.packPins).toEqual(house().packPins);
    expect(designBrands(made.doc)).toEqual([]);
  });

  it("is the one chosen before the first unit, which pins its edition, and can change until a unit is in", () => {
    const made = newSystem(house(), "2026.1");
    let d = chooseBrand(made.doc, made.systemId, "daikin", "2026.1");
    expect(d.systems[0].brand).toBe("daikin");
    expect(d.packPins.daikin).toBe("2026.1");
    d = chooseBrand(d, made.systemId, "mitsubishi-electric", "2026.1");
    expect(d.systems[0].brand).toBe("mitsubishi-electric");
    d = claimZone(d, made.systemId, "living");
    d = addHead(d, me, { systemId: made.systemId, zoneId: "living", iduModel: wall(me).model });
    /* a unit in: the system is that brand's, and stays it */
    expect(chooseBrand(d, made.systemId, "daikin", "2026.1")).toBe(d);
  });

  it("comes from the unit a system is made with: a Daikin split is Daikin's, a multi head its maker's", () => {
    const idu = wall(daikin).model;
    const split = addSplit(house(), daikin, { roomId: "living", iduModel: idu, oduModel: pairFor(daikin, idu) });
    expect(split.doc.systems[0].brand).toBe("daikin");
    expect(split.doc.packPins.daikin).toBeDefined();
    expect(split.doc.packPins["mitsubishi-electric"]).toBeUndefined();
    const head = me.indoor_units.find((u) => u.system_roles.includes("vrf"))!;
    const multi = addMultiHead(house(), me, "cooling", { systemId: null, roomId: "bed1", iduModel: head.model });
    expect(multi.doc.systems[0].brand).toBe("mitsubishi-electric");
  });

  it("is kept by a saved design's system, whichever brand it is", () => {
    const idu = wall(daikin).model;
    const d = addSplit(house(), daikin, { roomId: "living", iduModel: idu, oduModel: pairFor(daikin, idu) }).doc;
    const again = addHead(d, daikin, { systemId: d.systems[0].id, zoneId: "living", iduModel: idu });
    expect(again.systems[0].brand).toBe("daikin");
  });
});

describe("the packs a design reads", () => {
  it("are every brand its systems name, as one pack; one brand alone is its own pack", () => {
    const both = joinPacks([me, daikin])!;
    expect(both.meta.brand).toBe("");
    expect(both.indoor_units.length).toBe(me.indoor_units.length + daikin.indoor_units.length);
    expect(joinPacks([daikin])).toBe(daikin);
    expect(joinPacks([])).toBeNull();
  });

  it("offer a system only its brand's units", () => {
    const both = joinPacks([me, daikin])!;
    const own = brandOnly(both, "daikin");
    expect(own.meta.brand).toBe("daikin");
    expect(own.indoor_units.every((u) => u.brand === "daikin")).toBe(true);
    expect(own.indoor_units.length).toBe(daikin.indoor_units.length);
    expect(own.brands.map((b) => b.id)).toEqual(["daikin"]);
  });
});

describe("the builder, before the first unit", () => {
  function open(doc: DesignDocument, systemId: string, wanted: string[] = []) {
    const onWant = jest.fn((b: string) => wanted.push(b));
    const view = render(
      <SystemBuilder
        next
        doc={doc}
        pack={joinPacks(Object.values(packs)) ?? NO_PACK}
        packFor={(b) => packs[b] ?? null}
        brands={BRANDS}
        onWantBrand={onWant}
        systemId={systemId}
        onCommit={() => {}}
        onClose={() => {}}
      />
    );
    return { view, onWant };
  }

  it("asks for the brand and offers no unit until one is chosen", () => {
    const made = newSystem(house(), "2026.1");
    const d = claimZone(made.doc, made.systemId, "living");
    const { onWant } = open(d, made.systemId);
    const field = screen.getByRole("combobox", { name: /Brand/ });
    expect(field).toHaveTextContent("Choose a brand");
    expect(screen.queryByRole("region", { name: "Choose a unit" })).toBeNull();
    fireEvent.click(field);
    fireEvent.click(screen.getByRole("option", { name: "Daikin" }));
    expect(onWant).toHaveBeenCalledWith("daikin");
    /* Daikin's units, and only Daikin's */
    const list = screen.getByRole("region", { name: "Choose a unit" });
    const find = (model: string) => {
      fireEvent.change(within(list).getByRole("textbox", { name: "Search units" }), { target: { value: model } });
      return [...list.querySelectorAll(".pt-row-name")].some((n) => n.textContent === model);
    };
    expect(find(wall(daikin).model)).toBe(true);
    expect(find(wall(me).model)).toBe(false);
    expect(within(list).getByRole("combobox", { name: /Brand/ })).toHaveTextContent("Daikin");
  });

  it("shows a system with units no Brand field: its brand is a fact", () => {
    const made = newSystem(house(), "2026.1", "mitsubishi-electric");
    let d = claimZone(made.doc, made.systemId, "living");
    d = addHead(d, me, { systemId: made.systemId, zoneId: "living", iduModel: wall(me).model });
    expect(allocationsOf(d.systems[0]).length).toBeGreaterThan(0);
    open(d, made.systemId);
    expect(screen.queryByRole("combobox", { name: /Brand/ })).toBeNull();
  });
});
