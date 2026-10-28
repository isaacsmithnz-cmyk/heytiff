/* The ductwork on the plan (duct-layer.tsx): what the Studio lays out for a
   ducted unit is drawn — outlets, the return with its filter, a circle where
   two runs part named by its ducts, each run's size — an outlet dragged with
   Select is kept where it was let go, a circle is made a Y or a BTO, and a
   unit's ductwork can be taken off from the plan. */

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
import { outletPicks } from "@/lib/studio/outlets";
import { setZoning } from "@/lib/studio/zoning";
import { ductsDrawn, setDuctsDrawn } from "@/lib/studio/airflow";

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
  d = setDuctsDrawn(d, made.systemId, unit.id, true);
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
    expect(screen.getAllByRole("img", { name: /^Square diffuser, \d+ neck, \d+ L\/s$/ })).toHaveLength(lay.outlets.length);
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

  it("a click on an outlet opens its tray; Round and a neck are kept on the system, and a drag is not a click", () => {
    const h = house();
    const onMutate = jest.fn();
    draw(h.doc, onMutate);
    const [outlet] = screen.getAllByRole("img", { name: /^Square diffuser/ });
    // a drag moves it and opens nothing
    fireEvent.pointerDown(outlet, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(outlet, { clientX: 60, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(outlet, { clientX: 60, clientY: 10, pointerId: 1 });
    expect(screen.queryByRole("button", { name: "Round" })).toBeNull();
    // a click opens the tray and moves nothing
    onMutate.mockClear();
    fireEvent.pointerDown(outlet, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(outlet, { clientX: 11, clientY: 10, pointerId: 1 });
    expect(onMutate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Square" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Round" }));
    let after = onMutate.mock.calls[0][0](h.doc) as DesignDocument;
    const [[key, pick]] = Object.entries(outletPicks(after.systems[0]));
    expect(pick).toEqual({ kind: "round" });
    fireEvent.click(screen.getByRole("button", { name: "300" }));
    after = onMutate.mock.calls[1][0](after) as DesignDocument;
    expect(outletPicks(after.systems[0])[key]).toEqual({ kind: "round", neckMm: 300 });
  });

  it("a linear is drawn at its length and height, and its end drawn further snaps to a stock length", () => {
    const h = house();
    const [lay] = systemDuctwork(h.doc, pack, h.doc.systems[0]);
    const key = lay.outlets[0].key;
    const doc = {
      ...h.doc,
      systems: h.doc.systems.map((s) => ({ ...s, settings: { ...s.settings, ductOutlet: { [key]: { kind: "linear" } } } })),
    };
    const onMutate = jest.fn();
    draw(doc, onMutate);
    const grille = screen.getByRole("img", { name: /^Linear bar grille 1200 × 150, \d+ L\/s$/ });
    fireEvent.pointerDown(grille, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(grille, { clientX: 0, clientY: 0, pointerId: 1 });
    expect(screen.getByRole("spinbutton")).toHaveValue(1200);
    const end = screen.getByRole("img", { name: "End of the grille" });
    const x = Number(end.getAttribute("cx"));
    const y = Number(end.getAttribute("cy"));
    fireEvent.pointerDown(end, { clientX: x, clientY: y, pointerId: 2 });
    fireEvent.pointerMove(end, { clientX: x + 35, clientY: y, pointerId: 2 });
    fireEvent.pointerUp(end, { clientX: x + 35, clientY: y, pointerId: 2 });
    const after = onMutate.mock.calls[0][0](doc) as DesignDocument;
    // 1200 + 350 drawn on at 10 mm a unit is 1550: the nearest stock is 1500
    expect(outletPicks(after.systems[0])[key]).toMatchObject({ kind: "linear", lengthMm: 1500, along: { x: 1, y: 0 } });
  });

  it("zoned, it draws a damper on each zone's run, a sensor a zone and the controller, and a sensor drags", () => {
    const h = house();
    const unit = allocationsOf(h.doc.systems[0]).find((a) => a.role === "idu")!;
    const doc = setZoning(h.doc, h.systemId, unit.id, { control: "temperature" });
    const onMutate = jest.fn();
    draw(doc, onMutate);
    expect(screen.getAllByRole("img", { name: /^Zone damper Ø\d+, Z\d / }).length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByRole("img", { name: /^Sensor, Z\d / })).toHaveLength(4);
    expect(screen.getByRole("img", { name: "Zone controller" })).toBeInTheDocument();
    const [sensor] = screen.getAllByRole("img", { name: /^Sensor/ });
    fireEvent.pointerDown(sensor, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(sensor, { clientX: 300, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(sensor, { clientX: 300, clientY: 300, pointerId: 1 });
    const after = onMutate.mock.calls[0][0](doc) as DesignDocument;
    expect(Object.entries(draggedAt(after.systems[0]))).toEqual([[`${unit.id}/sensor/living`, { x: 300, y: 300 }]]);
  });

  it("a click on a run offers Remove ductwork, which takes the unit's ductwork off", () => {
    const h = house();
    const onMutate = jest.fn();
    const { container } = draw(h.doc, onMutate);
    fireEvent.click(container.querySelector(".ds-duct.supply")!, { clientX: m(3), clientY: m(3) });
    fireEvent.click(screen.getByRole("button", { name: "Remove ductwork" }));
    const after: DesignDocument = onMutate.mock.calls[0][0](h.doc);
    const unit = allocationsOf(after.systems[0]).find((a) => a.role === "idu")!;
    expect(ductsDrawn(after.systems[0], unit.id)).toBe(false);
    expect(systemDuctwork(after, pack, after.systems[0])).toEqual([]);
  });

  it("offers nothing to take off without Select", () => {
    const h = house();
    const { container } = draw(h.doc, jest.fn(), false);
    fireEvent.click(container.querySelector(".ds-duct.supply")!, { clientX: m(3), clientY: m(3) });
    expect(screen.queryByRole("button", { name: "Remove ductwork" })).toBeNull();
  });
});
