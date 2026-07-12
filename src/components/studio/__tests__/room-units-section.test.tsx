/* RoomUnitsSection (relocated onto the room card): shows "Select units" until
   the active system has a chosen pair, then the two draggable unit cards. */

import { render, screen, fireEvent } from "@testing-library/react";
import { RoomUnitsSection } from "../split-panel";
import {
  createDesign,
  type DesignDocument,
  type DesignObject,
  type DesignSystem,
} from "@/lib/studio/document";
import type { RoomObj } from "@/lib/studio/loads-room";

const room: RoomObj = {
  id: "room1",
  type: "room",
  systemId: "sys1",
  floorId: "flr",
  geometry: {
    kind: "polygon",
    points: [
      { x: 0, y: 0 },
      { x: 500, y: 0 },
      { x: 500, y: 400 },
      { x: 0, y: 400 },
    ],
  },
  plane: "room",
  props: { name: "Lounge" },
};

function docWith(system: DesignSystem): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-07-10T00:00:00.000Z" });
  d.floors = [{ id: "flr", name: "G", level: 0, scaleMmPerUnit: 10, northDeg: null, northPos: null, plans: [] }];
  d.systems = [system];
  d.objects = [room];
  return d;
}

const sys = (settings: Record<string, unknown>): DesignSystem => ({
  id: "sys1",
  type: "split",
  brand: "mitsubishi-electric",
  colour: "#2E68FF",
  name: "System 1",
  settings,
});

describe("RoomUnitsSection", () => {
  it("shows Select units until a pair is chosen", () => {
    render(
      <RoomUnitsSection
        doc={docWith(sys({}))}
        pack={null}
        system={sys({})}
        room={room}
        basis="cooling"
        onMutate={() => {}}
        onArmPlace={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: /Select units/ })).toBeInTheDocument();
    expect(screen.queryByTestId("unit-card-idu")).not.toBeInTheDocument();
  });

  it("renders the indoor + outdoor drag cards once a pair is chosen", () => {
    const system = sys({ pairIdu: "SLZ-M25FA-A", pairOdu: "SUZ-M25VAD-A" });
    render(
      <RoomUnitsSection
        doc={docWith(system)}
        pack={null}
        system={system}
        room={room}
        basis="cooling"
        onMutate={() => {}}
        onArmPlace={() => {}}
      />
    );
    expect(screen.getByTestId("unit-card-idu")).toBeInTheDocument();
    expect(screen.getByTestId("unit-card-odu")).toBeInTheDocument();
    expect(screen.getByText("SLZ-M25FA-A")).toBeInTheDocument();
    expect(screen.getByText("SUZ-M25VAD-A")).toBeInTheDocument();
  });

  it("recall removes the placed unit and the system's pipework, keeping the rest", () => {
    const system = sys({ pairIdu: "SLZ-M25FA-A", pairOdu: "SUZ-M25VAD-A" });
    const d = docWith(system);
    const unit = (id: string, role: "idu" | "odu"): DesignObject => ({
      id,
      type: "unit",
      systemId: "sys1",
      floorId: "flr",
      geometry: { kind: "point", at: { x: 100, y: 100 } },
      plane: role === "idu" ? "room" : "external-ground",
      props: { role, model: role === "idu" ? "SLZ-M25FA-A" : "SUZ-M25VAD-A" },
    });
    d.objects.push(unit("u_idu", "idu"), unit("u_odu", "odu"), {
      id: "run1",
      type: "pipe-run",
      systemId: "sys1",
      floorId: "flr",
      geometry: { kind: "polyline", points: [{ x: 100, y: 100 }, { x: 300, y: 100 }] },
      plane: "room",
      props: {},
    });

    let next: DesignDocument | undefined;
    render(
      <RoomUnitsSection
        doc={d}
        pack={null}
        system={system}
        room={room}
        basis="cooling"
        onMutate={(fn) => (next = fn(d))}
        onArmPlace={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Recall Indoor unit" }));

    const ids = next!.objects.map((o) => o.id);
    expect(ids).not.toContain("u_idu"); // the recalled unit is gone
    expect(ids).not.toContain("run1"); // its pipework dropped (would dangle)
    expect(ids).toContain("u_odu"); // the outdoor unit stays
    expect(ids).toContain("room1"); // the room stays
  });

  it("Change stays available after the units are placed (swap the pair)", () => {
    const system = sys({ pairIdu: "SLZ-M25FA-A", pairOdu: "SUZ-M25VAD-A" });
    const d = docWith(system);
    d.objects.push({
      id: "u_idu",
      type: "unit",
      systemId: "sys1",
      floorId: "flr",
      geometry: { kind: "point", at: { x: 0, y: 0 } },
      plane: "room",
      props: { role: "idu", model: "SLZ-M25FA-A" },
    });
    render(
      <RoomUnitsSection
        doc={d}
        pack={null}
        system={system}
        room={room}
        basis="cooling"
        onMutate={() => {}}
        onArmPlace={() => {}}
      />
    );
    // previously hidden once placed; now always offered while a pair is chosen
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
  });
});
