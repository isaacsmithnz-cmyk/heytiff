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
    { id: "flr", name: "Ground", level: 0, scaleMmPerUnit: 10, northDeg: null, northPos: null, plans: [] },
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

  it("lets you type a decimal ceiling height — the dot used to be eaten", () => {
    render(
      <RoomModal doc={docWithRoom()} roomId="room1" onMutate={() => {}} onClose={() => {}} />
    );
    const h = screen.getByLabelText("Ceiling height (m)") as HTMLInputElement;
    // default 2.4 m over 20 m² → 48 m³
    expect(screen.getByText(/48 m³/)).toBeInTheDocument();

    // a bare "2." must SURVIVE keystroke-to-keystroke — the old code reparsed
    // it to 2 and the dot vanished, so 2.4 was unreachable
    fireEvent.change(h, { target: { value: "2." } });
    expect(h.value).toBe("2.");

    // finishing the decimal flows into the volume: 20 × 2.7 = 54 m³
    fireEvent.change(h, { target: { value: "2.7" } });
    expect(h.value).toBe("2.7");
    expect(screen.getByText(/54 m³/)).toBeInTheDocument();

    // letters are rejected outright (input unchanged)
    fireEvent.change(h, { target: { value: "2.7x" } });
    expect(h.value).toBe("2.7");

    // clearing then blurring normalises back to the 2.4 default
    fireEvent.change(h, { target: { value: "" } });
    expect(h.value).toBe("");
    fireEvent.blur(h);
    expect(h.value).toBe("2.4");
  });

  it("shows the reference-sheets link regardless of external walls", () => {
    const open = jest.fn();
    // no external walls marked
    const { unmount } = render(
      <RoomModal doc={docWithRoom()} roomId="room1" onMutate={() => {}} onClose={() => {}} onOpenReference={open} />
    );
    expect(screen.getByRole("button", { name: /reference sheets/i })).toBeInTheDocument();
    unmount();

    // with an external wall marked
    const doc = docWithRoom();
    doc.objects[0].props.externalWalls = [0];
    render(
      <RoomModal doc={doc} roomId="room1" onMutate={() => {}} onClose={() => {}} onOpenReference={open} />
    );
    expect(screen.getByRole("button", { name: /reference sheets/i })).toBeInTheDocument();
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

/* Two faces (Isaac, 2026-08-25). A room fresh off the canvas goes straight
   into the heat-load wizard — that IS the setup, and units have no part in
   sizing a space. Every visit after that opens on a review face: the same
   green banner the wizard ends on, titled with the room's own name, then the
   way back into the wizard, then whatever is serving the room. */
describe("RoomModal — setup vs review", () => {
  const configured = () => {
    const d = docWithRoom();
    d.objects[0].props.configured = true;
    return d;
  };
  const units = <div data-testid="units-slot">units</div>;

  it("a new room opens in the wizard, with no units in sight", () => {
    render(
      <RoomModal
        doc={docWithRoom()}
        roomId="room1"
        onMutate={() => {}}
        onClose={() => {}}
        unitsSection={units}
      />
    );
    expect(screen.getByText("New room")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. Living / Dining")).toBeInTheDocument();
    expect(screen.queryByTestId("units-slot")).not.toBeInTheDocument();
  });

  it("a configured room opens on the review face: banner, the way back, units", () => {
    render(
      <RoomModal
        doc={configured()}
        roomId="room1"
        onMutate={() => {}}
        onClose={() => {}}
        unitsSection={units}
      />
    );
    /* the modal PORTALS to body, so query the document — render()'s own
       container holds nothing */
    const banner = document.querySelector(".ds-rm-review .ds-rm-load")!;
    expect(banner).not.toBeNull();
    expect(banner.querySelector(".ds-rm-load-t")!.textContent).toBe("Lounge");
    expect(banner.querySelector(".ds-rm-load-kw")!.textContent).toMatch(/kW$/);

    expect(screen.getByTestId("units-slot")).toBeInTheDocument();
    /* nothing has been edited here, so there is nothing to save or cancel */
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save room" })).toBeNull();
    /* and the name is not printed twice — the banner carries it, not the head */
    expect(document.querySelector(".ds-rm-title")!.textContent).not.toContain("Lounge");
  });

  it("Edit heat load unfolds the wizard in place and takes the units away", () => {
    render(
      <RoomModal
        doc={configured()}
        roomId="room1"
        onMutate={() => {}}
        onClose={() => {}}
        unitsSection={units}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Edit heat load/ }));
    expect(screen.getByPlaceholderText("e.g. Living / Dining")).toBeInTheDocument();
    expect(screen.queryByTestId("units-slot")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save room" })).toBeInTheDocument();
  });
});
