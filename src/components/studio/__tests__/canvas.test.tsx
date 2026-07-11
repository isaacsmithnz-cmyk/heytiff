/* Stage-1 canvas: drawing, derived areas, calibration re-derivation, undo.
   jsdom has no layout, so getBoundingClientRect is all zeros and the canvas
   falls back to its 800×600 default — client coords map straight to screen.
   Blank floor: scale 10 mm/unit → grid 100 units → zoom 0.56, world origin
   at screen centre (400,300). */

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Studio } from "../studio";
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

    expect(screen.getByText("Room 1")).toBeInTheDocument();
    expect(screen.getByText("0.8 m²")).toBeInTheDocument();

    // calibrate: 168 screen px = 300 units declared as 5 m → 16.67 mm/unit
    await user.click(screen.getByRole("button", { name: "Calibrate scale" }));
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

    // undo twice: calibration, then the room itself
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByText("0.8 m²")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByText("Room 1")).not.toBeInTheDocument();

    // redo restores the room
    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(screen.getByText("Room 1")).toBeInTheDocument();
  });

  it("dragging a rectangle's corner moves only that corner (no rectangle lock)", async () => {
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

    // free edit: ONLY corner 0 moved → a skewed quad, not a snapped rectangle
    const polygon = svg.querySelector(".ds-room polygon")!;
    expect(polygon.getAttribute("points")).toBe("25,25 100,0 100,100 0,100");

    // the lock-rectangle control is gone (polygon tool covers free editing)
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
    expect(screen.getByText("Room 1")).toBeInTheDocument();
  });

  it("selecting a room opens the inspector; renaming and deleting work", async () => {
    const { user, svg } = await openBlankDesignOnCanvas();
    await user.click(screen.getByRole("button", { name: "Room (rectangle)" }));
    fireEvent.pointerDown(svg, pt(400, 300));
    fireEvent.pointerMove(svg, pt(500, 380));
    fireEvent.pointerUp(svg, pt(500, 380));
    await finishRoom(user);

    // click inside the room with the select tool
    await user.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.pointerDown(svg, pt(430, 330));
    fireEvent.pointerUp(svg, pt(430, 330));

    // rename via the pencil → inline input → Enter commits
    await user.click(screen.getByRole("button", { name: "Rename room" }));
    const nameInput = screen.getByLabelText("Room name");
    await user.clear(nameInput);
    await user.type(nameInput, "Lounge{Enter}");
    // the canvas label follows the rename
    expect(svg.querySelector(".ds-room-name")?.textContent).toBe("Lounge");

    await user.click(screen.getByRole("button", { name: /Delete room/ }));
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
    expect(screen.getByText("Room 1")).toBeInTheDocument();
  });
});
