/* RoomUnitsSection (relocated onto the room card): shows "Select units" until
   the active system has a chosen pair, then the two draggable unit cards. */

import { render, screen } from "@testing-library/react";
import { RoomUnitsSection } from "../split-panel";
import { createDesign, type DesignDocument, type DesignSystem } from "@/lib/studio/document";
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
  d.floors = [{ id: "flr", name: "G", level: 0, scaleMmPerUnit: 10, northDeg: null, plans: [] }];
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
});
