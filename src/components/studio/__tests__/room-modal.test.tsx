/* Room configuration modal (Slice 2): live heat-load calculator + save writes
   the inputs. Area is derived from the polygon; the kW recomputes on input
   change from the Stage-3 engine. */

import { render, screen, fireEvent } from "@testing-library/react";
import { RoomModal } from "../room-modal";
import {
  createDesign,
  type DesignDocument,
  type DesignObject,
} from "@/lib/studio/document";

/* a calibrated blank floor (10 mm/unit) + a 500×400-unit room = 20 m² */
function docWithRoom(): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-07-07T00:00:00.000Z" });
  d.floors = [
    { id: "flr", name: "Ground", level: 0, scaleMmPerUnit: 10, northDeg: null, plans: [] },
  ];
  d.systems = [
    { id: "sys", type: "split", brand: "mitsubishi-electric", colour: "#2E68FF", name: "System 1", settings: {} },
  ];
  d.settings.climateZone = "5"; // Sydney, residential = 145 W/m²
  const room: DesignObject = {
    id: "room1",
    type: "room",
    systemId: "sys",
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
  d.objects = [room];
  return d;
}

describe("RoomModal", () => {
  it("shows the live heat load and recomputes when glazing changes", () => {
    render(
      <RoomModal doc={docWithRoom()} roomId="room1" onMutate={() => {}} onClose={() => {}} />
    );
    // 20 m² × 145 × moderate(1.0) × standard(1.0) × 2.4m(1.0) × internal(0.85
    // NO_SOLAR_MULT — no walls marked) = 2465 W → 2.46 kW
    expect(screen.getByText("2.46 kW")).toBeInTheDocument();

    // high glazing ×1.24 → 3057 W → 3.06 kW
    fireEvent.change(screen.getByDisplayValue("Moderate"), {
      target: { value: "high" },
    });
    expect(screen.getByText("3.06 kW")).toBeInTheDocument();
  });

  it("derives the area from the polygon", () => {
    render(
      <RoomModal doc={docWithRoom()} roomId="room1" onMutate={() => {}} onClose={() => {}} />
    );
    expect(screen.getByText(/20 m² · Zone 5 · 145 W\/m²/)).toBeInTheDocument();
  });

  it("save writes the inputs + configured flag to the room", () => {
    const doc = docWithRoom();
    let next: DesignDocument | null = null;
    render(
      <RoomModal
        doc={doc}
        roomId="room1"
        onMutate={(fn) => {
          next = fn(doc);
        }}
        onClose={() => {}}
      />
    );
    fireEvent.change(screen.getByDisplayValue("Moderate"), {
      target: { value: "high" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save room" }));

    const room = next!.objects.find((o) => o.id === "room1")!;
    expect(room.props.glazing).toBe("high");
    expect(room.props.configured).toBe(true);
    expect(room.props.orientation).toBeDefined();
  });

  it("orientation is greyed until external walls are marked on the plan", () => {
    // no marked walls → internal / party room, no solar gain, orientation off
    const { unmount } = render(
      <RoomModal doc={docWithRoom()} roomId="room1" onMutate={() => {}} onClose={() => {}} />
    );
    expect(
      screen.getByRole("combobox", { name: /Orientation/ })
    ).toBeDisabled();
    expect(screen.getByText(/internal \/ party room/)).toBeInTheDocument();
    unmount();

    // once a wall is marked, orientation is derived and editable
    const doc = docWithRoom();
    doc.objects[0].props.externalWalls = [0];
    render(
      <RoomModal doc={doc} roomId="room1" onMutate={() => {}} onClose={() => {}} />
    );
    expect(
      screen.getByRole("combobox", { name: /Orientation/ })
    ).not.toBeDisabled();
    expect(screen.getByText("Auto – walls")).toBeInTheDocument();
  });
});
