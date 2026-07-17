/* Cockpit object card — selecting a placed unit / riser / pipe-run swaps the
   Inspect slot to the object card (serves-room, riser inputs, delete), and a
   selected IDU highlights its room pill. */

import { render, screen, fireEvent } from "@testing-library/react";
import { SystemCockpit } from "../cockpit-panel";
import { createDesign, type DesignDocument, type DesignObject, type Floor } from "@/lib/studio/document";
import { emptyPack } from "@/lib/studio/packs/schema";

const pack = emptyPack({ brand: "me", version: "1", packSchemaVersion: 1, name: "t" });
const floor: Floor = { id: "flr", name: "Ground", level: 0, scaleMmPerUnit: 10, northDeg: null, northPos: null, plans: [] };

const room = (id: string, name: string): DesignObject => ({
  id,
  type: "room",
  systemId: "sys1",
  floorId: "flr",
  geometry: { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }] },
  plane: "room",
  props: { name },
});

const idu: DesignObject = {
  id: "u_idu",
  type: "unit",
  systemId: "sys1",
  floorId: "flr",
  geometry: { kind: "point", at: { x: 50, y: 50 } },
  plane: "room",
  props: { role: "idu", model: "WALL-25", roomId: "room1" },
};
const riser: DesignObject = {
  id: "riser1",
  type: "riser",
  systemId: "sys1",
  floorId: "flr",
  geometry: { kind: "point", at: { x: 80, y: 80 } },
  plane: "room",
  props: { group: "A", heightM: 3 },
};
const run: DesignObject = {
  id: "run1",
  type: "pipe-run",
  systemId: "sys1",
  floorId: "flr",
  geometry: { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
  plane: "room",
  props: { startAttach: { kind: "unit", id: "u_idu" } },
};

function mkDoc(objects: DesignObject[]): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-07-11T00:00:00.000Z" });
  d.floors = [floor];
  d.settings.climateZone = "5";
  d.systems = [
    { id: "sys1", type: "split", brand: "me", colour: "#2E68FF", name: "System 1", settings: { pairIdu: "WALL-25", pairOdu: "OD-25" } },
  ];
  d.objects = objects;
  return d;
}

function renderCockpit(
  doc: DesignDocument,
  selectedId: string,
  handlers: { onMutate?: (fn: (d: DesignDocument) => DesignDocument) => void; onSelect?: (id: string | null) => void } = {}
) {
  return render(
    <SystemCockpit
      doc={doc}
      pack={pack}
      packVersion="1"
      activeSystemId="sys1"
      onActivate={() => {}}
      onMutate={handlers.onMutate ?? (() => {})}
      selectedId={selectedId}
      onSelect={handlers.onSelect ?? (() => {})}
      onEditRoom={() => {}}
      onArmPlace={() => {}}
      onDrawRoom={() => {}}
      floor={floor}
    />
  );
}

describe("Cockpit object card", () => {
  it("selecting an IDU shows its object card and highlights its room pill", () => {
    const doc = mkDoc([room("room1", "Living"), room("room2", "Study"), idu]);
    renderCockpit(doc, "u_idu");
    // object card, not the room inspect card
    expect(screen.getByText("Indoor unit")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Serves room" })).toBeInTheDocument();
    // the IDU's room pill is highlighted
    expect(screen.getByRole("button", { name: /Living/ }).className).toMatch(/\bon\b/);
    expect(screen.getByRole("button", { name: /Study/ }).className).not.toMatch(/\bon\b/);
  });

  it("re-attributing an IDU writes its roomId", () => {
    const doc = mkDoc([room("room1", "Living"), room("room2", "Study"), idu]);
    let next: DesignDocument | undefined;
    renderCockpit(doc, "u_idu", { onMutate: (fn) => (next = fn(doc)) });
    fireEvent.change(screen.getByRole("combobox", { name: "Serves room" }), { target: { value: "room2" } });
    expect(next!.objects.find((o) => o.id === "u_idu")!.props.roomId).toBe("room2");
  });

  it("selecting a riser shows its group + rise inputs", () => {
    const doc = mkDoc([room("room1", "Living"), riser]);
    renderCockpit(doc, "riser1");
    expect(screen.getByText("Riser")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete riser" })).toBeInTheDocument();
  });

  it("selecting a pipe-run shows its attached ends", () => {
    const doc = mkDoc([room("room1", "Living"), run]);
    renderCockpit(doc, "run1");
    // Pipework (Components pane) also lists "Refrigerant run"; target the object card
    expect(screen.getByText("Refrigerant run", { selector: ".ds-ck-iname" })).toBeInTheDocument();
    expect(screen.getByText("1 of 2 ends")).toBeInTheDocument();
  });

  it("delete removes the object and clears the selection", () => {
    const doc = mkDoc([room("room1", "Living"), riser]);
    let next: DesignDocument | undefined;
    const cleared: (string | null)[] = [];
    renderCockpit(doc, "riser1", { onMutate: (fn) => (next = fn(doc)), onSelect: (id) => cleared.push(id) });
    fireEvent.click(screen.getByRole("button", { name: "Delete riser" }));
    expect(next!.objects.map((o) => o.id)).not.toContain("riser1");
    expect(cleared).toContain(null);
  });
});
