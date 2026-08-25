/* Cockpit Components view — derived ODU + refrigerant rows, and the electrical/
   mounting choice rows that expand and persist onto settings.components. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { render, screen, fireEvent } from "@testing-library/react";
import { SystemCockpit } from "../cockpit-panel";
import { createDesign, type DesignDocument, type DesignObject, type Floor } from "@/lib/studio/document";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "@/lib/studio/packs/schema";
import { assemblePack, type PackSource } from "@/lib/studio/packs/loader";

const SEED = join(__dirname, "../../../../data/packs/mitsubishi-electric@2026.1");
function loadPack(): DataPack {
  const meta = JSON.parse(readFileSync(join(SEED, "meta.json"), "utf8")) as PackMeta;
  const sections: PackSource["sections"] = {};
  for (const s of PACK_SECTIONS) {
    const f = join(SEED, `${s}.json`);
    if (existsSync(f)) sections[s] = JSON.parse(readFileSync(f, "utf8"));
  }
  return assemblePack({ meta, sections });
}
const pack = loadPack();
const floor: Floor = { id: "flr", name: "Ground", level: 0, scaleMmPerUnit: 10, northDeg: null, northPos: null, plans: [] };

const room: DesignObject = {
  id: "room1",
  type: "room",
  systemId: "sys1",
  floorId: "flr",
  geometry: { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }] },
  plane: "room",
  props: { name: "Bedroom" },
};

function mkDoc(settings: Record<string, unknown> = {}): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-07-11T00:00:00.000Z" });
  d.floors = [floor];
  d.settings.climateZone = "5";
  d.systems = [
    { id: "sys1", type: "split", brand: "mitsubishi-electric", colour: "#2E68FF", name: "System 1", settings: { pairIdu: "SLZ-M25FA-A", pairOdu: "SUZ-M25VAD-A", ...settings } },
  ];
  d.objects = [room];
  return d;
}

function renderComponents(doc: DesignDocument, onMutate: (fn: (d: DesignDocument) => DesignDocument) => void = () => {}) {
  render(
    <SystemCockpit
      doc={doc}
      pack={pack}
      packVersion="2026.1"
      activeSystemId="sys1"
      onActivate={() => {}}
      onMutate={onMutate}
      selectedId={null}
      onSelect={() => {}}
      onEditRoom={() => {}}
      rest={{ rested: false, wouldRest: false, onExpand: () => {}, onRest: () => {} }}
      floor={floor}
      onAddVariant={() => {}}
      onSwitchVariant={() => {}}
      onRenameVariant={() => {}}
    />
  );
  // reveal the Components view
  fireEvent.click(screen.getByRole("tab", { name: /Components/ }));
}

describe("Cockpit Components view", () => {
  it("lists the derived ODU + refrigerant rows and the choice rows", () => {
    renderComponents(mkDoc());
    expect(screen.getByText("Outdoor unit")).toBeInTheDocument();
    // the model also appears in the (still-mounted) Rooms pane's unit row
    expect(screen.getByText("SUZ-M25VAD-A", { selector: ".ds-ck-compname" })).toBeInTheDocument();
    expect(screen.getByText("Refrigerant charge")).toBeInTheDocument();
    expect(screen.getByText("Electrical")).toBeInTheDocument();
    expect(screen.getByText("Mounting")).toBeInTheDocument();
    // default electrical selection
    expect(screen.getByText("Isolator · 20 A")).toBeInTheDocument();
  });

  it("expanding a choice row reveals its options", () => {
    renderComponents(mkDoc());
    fireEvent.click(screen.getByRole("button", { name: /Electrical/ }));
    expect(screen.getByRole("button", { name: /Isolator · 32 A/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Supplied by others/ })).toBeInTheDocument();
  });

  it("picking an option persists it onto settings.components", () => {
    let next: DesignDocument | undefined;
    const doc = mkDoc();
    renderComponents(doc, (fn) => (next = fn(doc)));
    fireEvent.click(screen.getByRole("button", { name: /Mounting/ }));
    fireEvent.click(screen.getByRole("button", { name: /Roof frame/ }));
    expect((next!.systems[0].settings.components as Record<string, string>).mounting).toBe("roof-mount");
  });

  it("shows the Pipework section (moved off the room card) with the system's runs", () => {
    const doc = mkDoc();
    doc.objects = [
      room,
      {
        id: "run1",
        type: "pipe-run",
        systemId: "sys1",
        floorId: "flr",
        geometry: { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
        plane: "room",
        props: { startAttach: "u1" },
      },
    ];
    renderComponents(doc);
    // Pipework now lives in the Components pane, not behind a room-card sub-tab
    expect(screen.getByText("Pipework")).toBeInTheDocument();
    expect(screen.getByText("Refrigerant run", { selector: ".ds-ck-pt" })).toBeInTheDocument();
  });

  it("shows the empty state until a pair resolves", () => {
    // a system with no chosen pair → no components
    const d = createDesign({ name: "T", mode: "blank", now: "2026-07-11T00:00:00.000Z" });
    d.floors = [floor];
    d.systems = [{ id: "sys1", type: "split", brand: "me", colour: "#2E68FF", name: "System 1", settings: {} }];
    d.objects = [room];
    renderComponents(d);
    expect(screen.getByText("No components yet")).toBeInTheDocument();
  });
});
