/* The ductwork on the plan (duct-layer.tsx): what the Studio lays out for a
   ducted unit is drawn — outlets, the return with its filter, a circle where
   two runs part named by its ducts, each run's size — an outlet dragged with
   Select is kept where it was let go, and a circle is made a Y or a BTO. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { render, screen, fireEvent } from "@testing-library/react";
import { DuctLayer } from "../duct-layer";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "@/lib/studio/packs/schema";
import { assemblePack, type PackSource } from "@/lib/studio/packs/loader";
import { createDesign, type DesignDocument, type DesignObject } from "@/lib/studio/document";
import { addBandUnit, allocationsOf, placeAllocation } from "@/lib/studio/builder";
import { claimZone, newSystem } from "@/lib/studio/zones";
import { draggedAt, fittingKinds, systemDuctwork } from "@/lib/studio/ductwork";

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

function house(): { doc: DesignDocument; systemId: string } {
  const doc = createDesign({ name: "12 Example St", mode: "blank" });
  doc.floors[0] = { ...doc.floors[0], scaleMmPerUnit: 10 };
  const room = (id: string, name: string, x: number, y: number, w: number, h: number) =>
    doc.objects.push({
      id,
      type: "room",
      systemId: null,
      floorId: doc.floors[0].id,
      plane: "room",
      geometry: { kind: "polygon", points: [{ x: m(x), y: m(y) }, { x: m(x + w), y: m(y) }, { x: m(x + w), y: m(y + h) }, { x: m(x), y: m(y + h) }] },
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
  const unit = allocationsOf(d.systems[0]).find((a) => a.role === "idu")!;
  d = placeAllocation(d, pack, made.systemId, unit.id, d.floors[0].id, { x: m(6), y: m(6.25) });
  return { doc: d, systemId: made.systemId };
}

const draw = (doc: DesignDocument, onMutate = jest.fn(), interactive = true) =>
  render(
    <svg>
      <DuctLayer
        doc={doc}
        pack={pack}
        floor={doc.floors[0]}
        zoom={1}
        labelZoom={1}
        interactive={interactive}
        toWorld={(e) => ({ x: e.clientX, y: e.clientY })}
        onMutate={onMutate}
      />
    </svg>
  );

describe("DuctLayer", () => {
  it("draws the outlets, the return with its filter, the circles by name and each run's size", () => {
    const h = house();
    const [lay] = systemDuctwork(h.doc, pack, h.doc.systems[0]);
    draw(h.doc);
    expect(screen.getAllByRole("img", { name: /^Square diffuser \d+ neck, \d+ L\/s$/ })).toHaveLength(lay.outlets.length);
    expect(screen.getByRole("img", { name: "Return air grille 750 × 400, filter" })).toBeInTheDocument();
    expect(lay.fittings.length).toBeGreaterThan(0);
    for (const f of lay.fittings) expect(screen.getByRole("button", { name: f.name })).toBeInTheDocument();
    for (const r of lay.supply) expect(screen.getAllByText(`Ø${r.diaMm}`).length).toBeGreaterThan(0);
    expect(screen.getByText("Return, filter")).toBeInTheDocument();
  });

  it("a circle clicked offers Y and BTO; a pick names it, and the lit one again leaves it to the day", () => {
    const h = house();
    const [lay] = systemDuctwork(h.doc, pack, h.doc.systems[0]);
    const f = lay.fittings[0];
    const onMutate = jest.fn();
    const { rerender } = draw(h.doc, onMutate);
    expect(screen.queryByRole("group", { name: `Make ${f.name} as` })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: f.name }));
    fireEvent.click(screen.getByRole("button", { name: "BTO" }));
    const picked = onMutate.mock.calls[0][0](h.doc) as DesignDocument;
    expect(fittingKinds(picked.systems[0])).toEqual({ [f.key]: "bto" });
    // the tray closes on a pick
    expect(screen.queryByRole("button", { name: "BTO" })).toBeNull();
    rerender(
      <svg>
        <DuctLayer doc={picked} pack={pack} floor={picked.floors[0]} zoom={1} labelZoom={1} interactive toWorld={(e) => ({ x: e.clientX, y: e.clientY })} onMutate={onMutate} />
      </svg>
    );
    const asBto = f.name.replace(/^Fitting /, "BTO ");
    fireEvent.click(screen.getByRole("button", { name: asBto }));
    expect(screen.getByRole("button", { name: "BTO" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "BTO" }));
    const back = onMutate.mock.calls[1][0](picked) as DesignDocument;
    expect(fittingKinds(back.systems[0])).toEqual({});
  });

  it("keeps an outlet where it is let go", () => {
    const h = house();
    const onMutate = jest.fn();
    draw(h.doc, onMutate);
    const [outlet] = screen.getAllByRole("img", { name: /^Square diffuser/ });
    fireEvent.pointerDown(outlet, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(outlet, { clientX: 120, clientY: 820, pointerId: 1 });
    fireEvent.pointerUp(outlet, { clientX: 120, clientY: 820, pointerId: 1 });
    expect(onMutate).toHaveBeenCalledTimes(1);
    const after = onMutate.mock.calls[0][0](h.doc) as DesignDocument;
    expect(Object.values(draggedAt(after.systems[0]))).toEqual([{ x: 120, y: 820 }]);
  });

  it("nothing moves while another tool is armed", () => {
    const h = house();
    const onMutate = jest.fn();
    draw(h.doc, onMutate, false);
    const [outlet] = screen.getAllByRole("img", { name: /^Square diffuser/ });
    fireEvent.pointerDown(outlet, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(outlet, { clientX: 50, clientY: 50, pointerId: 1 });
    expect(onMutate).not.toHaveBeenCalled();
  });

  it("draws nothing before the plan has a scale", () => {
    const h = house();
    const doc = { ...h.doc, floors: [{ ...h.doc.floors[0], scaleMmPerUnit: null }] };
    const { container } = draw(doc);
    expect(container.querySelector(".ds-ducts")).toBeNull();
  });
});
