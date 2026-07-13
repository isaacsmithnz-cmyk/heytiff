/* Stage-1 canvas: drawing, derived areas, calibration re-derivation, undo.
   jsdom has no layout, so getBoundingClientRect is all zeros and the canvas
   falls back to its 800×600 default — client coords map straight to screen.
   Blank floor: scale 10 mm/unit → grid 100 units → zoom 0.56, world origin
   at screen centre (400,300). */

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Studio } from "../studio";
import { redetectOrientations } from "../canvas";
import { LocalDesignStore } from "@/lib/studio/store";

const localStudio = () => (
  <Studio store={new LocalDesignStore(window.localStorage)} />
);

async function openBlankDesignOnCanvas() {
  const user = userEvent.setup();
  render(localStudio());
  await user.click(await screen.findByText("New design"));
  await user.type(screen.getByPlaceholderText(/Design name/), "Canvas test");
  await user.click(screen.getByRole("button", { name: /Continue/ }));
  await user.click(screen.getByText("Blank canvas"));
  await user.click(screen.getByRole("button", { name: "2 Design" }));
  // type-first flow: pick a system type before the room tools unlock
  await user.click(screen.getByRole("button", { name: /Split \(1:1\)/ }));
  const canvas = screen.getByTestId("studio-canvas");
  const svg = canvas.querySelector("svg")!;
  expect(svg).toBeTruthy();
  return { user, svg };
}

const pt = (x: number, y: number) => ({
  clientX: x,
  clientY: y,
  button: 0,
  pointerId: 1,
});

/* Closing a boundary opens wall-marking first (DUCTR parity). Commit it with
   no external walls, then dismiss the load modal — the room stays either way. */
async function finishRoom(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "No external walls" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
}

describe("Design canvas", () => {
  beforeEach(() => window.localStorage.clear());

  it("draws a rectangle room with a derived area, recalibrates, and undoes", async () => {
    const { user, svg } = await openBlankDesignOnCanvas();

    // rect tool: drag (400,300) → (456,342) = 100×75 units @10mm = 0.75 m²
    await user.click(screen.getByRole("button", { name: "Room (rectangle)" }));
    fireEvent.pointerDown(svg, pt(400, 300));
    fireEvent.pointerMove(svg, pt(456, 342));
    fireEvent.pointerUp(svg, pt(456, 342));
    // drawing opens wall-marking, then the load modal — commit and dismiss
    await finishRoom(user);

    expect(svg.querySelector(".ds-room-name")?.textContent).toBe("Room 1");
    expect(screen.getByText("0.8 m²")).toBeInTheDocument();

    // calibrate: 168 screen px = 300 units declared as 5 m → 16.67 mm/unit
    // (already-calibrated floors show a value pill; click it to recalibrate)
    await user.click(screen.getByTitle("Recalibrate the scale"));
    fireEvent.pointerDown(svg, pt(400, 300));
    fireEvent.pointerUp(svg, pt(400, 300));
    fireEvent.pointerDown(svg, pt(568, 300));
    fireEvent.pointerUp(svg, pt(568, 300));
    await user.type(
      screen.getByPlaceholderText("e.g. 3.6"),
      "5"
    );
    await user.click(screen.getByText("Set scale"));

    // same polygon, new scale: 7500 units² → 2.08 m² (areas derive, never stored)
    await waitFor(() =>
      expect(screen.getByText("2.1 m²")).toBeInTheDocument()
    );
    // the calibrate pill reflects the new scale (5 m / 300 units = 16.7 mm/px)
    expect(screen.getByText("16.7 mm/px")).toBeInTheDocument();

    // undo twice: calibration, then the room itself
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByText("0.8 m²")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByText("Room 1")).not.toBeInTheDocument();

    // redo restores the room
    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(svg.querySelector(".ds-room-name")?.textContent).toBe("Room 1");
  });

  it("dragging a rectangle-room corner resizes it but keeps it rectangular", async () => {
    const { user, svg } = await openBlankDesignOnCanvas();
    // 100×100-unit room: screen (400,300) → (456,356)
    await user.click(screen.getByRole("button", { name: "Room (rectangle)" }));
    fireEvent.pointerDown(svg, pt(400, 300));
    fireEvent.pointerMove(svg, pt(456, 356));
    fireEvent.pointerUp(svg, pt(456, 356));
    await finishRoom(user);

    // select it, then drag corner 0 (at screen 400,300) inward +25,+25 units
    await user.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.pointerDown(svg, pt(420, 320));
    fireEvent.pointerUp(svg, pt(420, 320));
    const vertex = svg.querySelectorAll(".ds-vertex")[0]!;
    fireEvent.pointerDown(vertex, pt(400, 300));
    fireEvent.pointerMove(svg, pt(414, 314));
    fireEvent.pointerUp(svg, pt(414, 314));

    // rect stays rectangular: corner 0 → (25,25), the opposite corner (100,100)
    // stays put and the two neighbours follow — never a skewed quad
    const polygon = svg.querySelector(".ds-room polygon")!;
    expect(polygon.getAttribute("points")).toBe("25,25 100,25 100,100 25,100");

    // no lock toggle — rectangle-tool rooms stay rectangular automatically
    expect(
      screen.queryByRole("checkbox", { name: /Lock rectangle/ })
    ).toBeNull();
  });

  it("polygon tool highlights the first vertex when the cursor can close the loop", async () => {
    const { user, svg } = await openBlankDesignOnCanvas();
    await user.click(screen.getByRole("button", { name: "Room (polygon)" }));
    fireEvent.pointerDown(svg, pt(400, 300));
    fireEvent.pointerUp(svg, pt(400, 300));
    fireEvent.pointerDown(svg, pt(456, 300));
    fireEvent.pointerUp(svg, pt(456, 300));
    fireEvent.pointerDown(svg, pt(456, 356));
    fireEvent.pointerUp(svg, pt(456, 356));

    // far from the start: no close indicator
    fireEvent.pointerMove(svg, pt(440, 340));
    expect(svg.querySelector(".ds-draft circle.close-ready")).toBeNull();

    // hover the first vertex: indicator lights up, and clicking closes the room
    fireEvent.pointerMove(svg, pt(402, 302));
    expect(svg.querySelector(".ds-draft circle.close-ready")).not.toBeNull();
    fireEvent.pointerDown(svg, pt(402, 302));
    fireEvent.pointerUp(svg, pt(402, 302));
    await finishRoom(user);
    expect(svg.querySelector(".ds-room-name")?.textContent).toBe("Room 1");
  });

  it("selecting a room opens the Inspect card; Edit renames via the modal; Delete key removes it", async () => {
    const { user, svg } = await openBlankDesignOnCanvas();
    await user.click(screen.getByRole("button", { name: "Room (rectangle)" }));
    fireEvent.pointerDown(svg, pt(400, 300));
    fireEvent.pointerMove(svg, pt(500, 380));
    fireEvent.pointerUp(svg, pt(500, 380));
    await finishRoom(user);

    // click inside the room with the select tool → the cockpit Inspect card
    await user.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.pointerDown(svg, pt(430, 330));
    fireEvent.pointerUp(svg, pt(430, 330));

    // Configure → Edit opens the room modal (rename lives there now)
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const nameInput = screen.getByPlaceholderText("e.g. Living / Dining");
    await user.clear(nameInput);
    await user.type(nameInput, "Lounge");
    await user.click(screen.getByRole("button", { name: "Save room" }));
    // the canvas label follows the rename
    expect(svg.querySelector(".ds-room-name")?.textContent).toBe("Lounge");

    // the room stays selected → the canvas Delete key removes it
    fireEvent.keyDown(window, { key: "Delete" });
    expect(screen.queryByText("Lounge")).not.toBeInTheDocument();
  });

  it("wall-marking opens before the modal; Cancel discards the fresh room", async () => {
    const { user, svg } = await openBlankDesignOnCanvas();
    await user.click(screen.getByRole("button", { name: "Room (rectangle)" }));
    fireEvent.pointerDown(svg, pt(400, 300));
    fireEvent.pointerMove(svg, pt(456, 342));
    fireEvent.pointerUp(svg, pt(456, 342));

    // wall-marking panel, not the load modal, comes up first
    expect(screen.getByText("Mark external walls")).toBeInTheDocument();
    expect(screen.queryByText("Configure room")).not.toBeInTheDocument();

    // Cancel on a fresh draft throws the room away (DUCTR parity)
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Room 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Mark external walls")).not.toBeInTheDocument();
  });

  it("marking a wall commits the room and derives orientation from it", async () => {
    const { user, svg } = await openBlankDesignOnCanvas();
    await user.click(screen.getByRole("button", { name: "Room (rectangle)" }));
    // world rect (0,0)-(100,75); top edge midpoint is world (50,0) = screen (428,300)
    fireEvent.pointerDown(svg, pt(400, 300));
    fireEvent.pointerMove(svg, pt(456, 342));
    fireEvent.pointerUp(svg, pt(456, 342));

    // click the top edge to mark it external
    fireEvent.pointerDown(svg, pt(428, 300));
    fireEvent.pointerUp(svg, pt(428, 300));
    expect(screen.getByText("1 external wall marked")).toBeInTheDocument();

    // Done commits and opens the load modal, orientation now sourced from walls
    await user.click(screen.getByRole("button", { name: "Done" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("New")).toBeInTheDocument(); // mode pill
    expect(screen.getByText("Auto – walls")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(svg.querySelector(".ds-room-name")?.textContent).toBe("Room 1");
  });

  it("places rooms free (pixel-precise) — no grid snapping", async () => {
    const { user, svg } = await openBlankDesignOnCanvas();
    await user.click(screen.getByRole("button", { name: "Room (rectangle)" }));
    // drag to screen (455,341) → world ≈ (98.21, 73.21): NOT on the old
    // grid/4 (=25) lattice, so free placement keeps the raw coordinate
    fireEvent.pointerDown(svg, pt(400, 300));
    fireEvent.pointerMove(svg, pt(455, 341));
    fireEvent.pointerUp(svg, pt(455, 341));
    await finishRoom(user);
    const points = svg.querySelector(".ds-room polygon")!.getAttribute("points")!;
    // would have snapped to "100,0 … 75" under the old behaviour
    expect(points).toMatch(/98\.2/);
    expect(points).not.toBe("0,0 100,0 100,75 0,75");
  });

  it("set-north places an arrow and dragging its tip rotates the bearing", async () => {
    const { user, svg } = await openBlankDesignOnCanvas();
    // set-north is a top-toolbar pill now, not a dock tool
    await user.click(screen.getByRole("button", { name: "Set north" }));
    // drop the arrow at screen (450,300) → world centre (~89,0)
    fireEvent.pointerDown(svg, pt(450, 300));
    fireEvent.pointerUp(svg, pt(450, 300));
    expect(svg.querySelector(".ds-north")).not.toBeNull();
    expect(screen.getByText(/North 0°/)).toBeInTheDocument();

    // in select mode, grab the rotate knob (world-sized: grid 100 → northKnob
    // ≈101.5 world; centre screen (450,300) → knob ≈ (450,243)) and drag a
    // quarter-turn: final cursor (476,300) is due-east of centre → 90°
    await user.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.pointerDown(svg, pt(450, 243));
    fireEvent.pointerMove(svg, pt(476, 300));
    fireEvent.pointerUp(svg, pt(476, 300));
    expect(screen.getByText(/North 90°/)).toBeInTheDocument();
  });

  it("the Labels layer toggle hides room name/area text", async () => {
    const { user, svg } = await openBlankDesignOnCanvas();
    await user.click(screen.getByRole("button", { name: "Room (rectangle)" }));
    fireEvent.pointerDown(svg, pt(400, 300));
    fireEvent.pointerMove(svg, pt(456, 342));
    fireEvent.pointerUp(svg, pt(456, 342));
    await finishRoom(user);
    expect(svg.querySelector(".ds-room-name")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Layers" }));
    await user.click(screen.getByRole("checkbox", { name: "Labels" }));
    expect(svg.querySelector(".ds-room-name")).toBeNull();
  });

  it("the eraser does not delete rooms (rooms delete via the inspector ✕)", async () => {
    const { user, svg } = await openBlankDesignOnCanvas();
    await user.click(screen.getByRole("button", { name: "Room (rectangle)" }));
    fireEvent.pointerDown(svg, pt(400, 300));
    fireEvent.pointerMove(svg, pt(500, 380));
    fireEvent.pointerUp(svg, pt(500, 380));
    await finishRoom(user);
    expect(svg.querySelector(".ds-room-name")?.textContent).toBe("Room 1");

    await user.click(screen.getByRole("button", { name: "Eraser" }));
    fireEvent.pointerDown(svg, pt(440, 330));
    fireEvent.pointerUp(svg, pt(440, 330));
    // still there — the eraser is objects-only
    expect(svg.querySelector(".ds-room-name")?.textContent).toBe("Room 1");
  });
});

describe("redetectOrientations", () => {
  const roomObj = (over: Record<string, unknown> = {}) => ({
    id: "r1",
    type: "room",
    systemId: null,
    floorId: "flr",
    geometry: {
      kind: "polygon" as const,
      // square; edge 0 is the top (points north when north=0)
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
    },
    plane: "room" as const,
    props: { externalWalls: [0], ...over },
  });

  it("re-derives orientation of non-locked rooms from the north bearing", () => {
    const [room] = redetectOrientations([roomObj()], "flr", 0);
    // top wall exposed, north=0 → faces North
    expect(room.props.orientation).toBe("N");
    // rotate north 180° → the same wall now faces South
    const [rot] = redetectOrientations([roomObj()], "flr", 180);
    expect(rot.props.orientation).toBe("S");
  });

  it("leaves manually-locked room orientations untouched", () => {
    const [room] = redetectOrientations(
      [roomObj({ orientation: "E", orientationLocked: true })],
      "flr",
      180
    );
    expect(room.props.orientation).toBe("E");
  });

  it("ignores rooms on other floors", () => {
    const other = { ...roomObj(), floorId: "flr2" };
    const [room] = redetectOrientations([other], "flr", 90);
    expect(room).toBe(other); // untouched reference
  });
});
