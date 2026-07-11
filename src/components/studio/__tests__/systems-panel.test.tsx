/* SystemsPanel — changing a system's type. Only `split` is an available module
   today, so the reachable path is re-picking the current type; that (and
   cancelling) must NOT delete the system's placed units — deletion happens only
   when the type actually changes. */

import { render, screen, fireEvent } from "@testing-library/react";
import { SystemsPanel } from "../split-panel";
import {
  createDesign,
  type DesignDocument,
  type DesignObject,
  type DesignSystem,
} from "@/lib/studio/document";
import { emptyPack } from "@/lib/studio/packs/schema";

const pack = emptyPack({ brand: "me", version: "1", packSchemaVersion: 1, name: "t" });

const system: DesignSystem = {
  id: "sys1",
  type: "split",
  brand: "me",
  colour: "#2E68FF",
  name: "System 1",
  settings: { pairIdu: "WALL-25", pairOdu: "OD-25" },
};

const placedIdu: DesignObject = {
  id: "u_idu",
  type: "unit",
  systemId: "sys1",
  floorId: "flr",
  geometry: { kind: "point", at: { x: 0, y: 0 } },
  plane: "room",
  props: { role: "idu", model: "WALL-25" },
};

function docWith(): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-07-11T00:00:00.000Z" });
  d.floors = [{ id: "flr", name: "G", level: 0, scaleMmPerUnit: 10, northDeg: null, plans: [] }];
  d.systems = [system];
  d.objects = [placedIdu];
  return d;
}

function renderPanel(onMutate = () => {}) {
  render(
    <SystemsPanel
      doc={docWith()}
      pack={pack}
      packVersion="1"
      activeSystemId="sys1"
      onActivate={() => {}}
      onMutate={onMutate}
      selectedRoomId={null}
      onSelectRoom={() => {}}
    />
  );
}

describe("SystemsPanel — change type", () => {
  it("offers a Change button that opens the type chooser", () => {
    renderPanel();
    fireEvent.click(screen.getByTitle(/Change system type/));
    expect(screen.getByText("Change system type")).toBeInTheDocument();
  });

  it("re-picking the current type does NOT delete the placed units", () => {
    const onMutate = jest.fn();
    renderPanel(onMutate);
    fireEvent.click(screen.getByTitle(/Change system type/));
    // split is the current type (and the only available one) — a no-op change
    fireEvent.click(screen.getByRole("button", { name: /Split/ }));
    expect(onMutate).not.toHaveBeenCalled(); // nothing removed
  });

  it("cancelling the chooser does NOT delete anything", () => {
    const onMutate = jest.fn();
    renderPanel(onMutate);
    fireEvent.click(screen.getByTitle(/Change system type/));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onMutate).not.toHaveBeenCalled();
    // back on the system view
    expect(screen.getByTitle(/Change system type/)).toBeInTheDocument();
  });
});
