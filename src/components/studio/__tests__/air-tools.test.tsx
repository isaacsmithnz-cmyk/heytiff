/* Ducted Step 2 — the air dock group, its spec-§2 gating, the component
   palette (eight entries, only Plenum live) and the options-HUD plenum
   variant. The dock gating runs through the full Studio (no pack loads under
   jsdom, so the air-capable-AHU gate stays honestly shut); the palette + HUD
   are driven directly. */

import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Studio } from "../studio";
import { ComponentPalette, PlenumHud, PALETTE_ENTRIES } from "../air-tools";
import { LocalDesignStore } from "@/lib/studio/store";

/* Room tools live on the canvas toolbar now — one labeled button per shape,
   armed with a single click. */
async function armRoom(
  user: ReturnType<typeof userEvent.setup>,
  shape: "Rectangle" | "Polygon" = "Rectangle"
) {
  // one Room button now — the shape choice flies out on click
  await user.click(await screen.findByRole("button", { name: "Room" }));
  await user.click(
    await screen.findByRole("menuitem", {
      name: shape === "Rectangle" ? /Square/ : /Shape/,
    })
  );
}


const localStudio = () => (
  <Studio store={new LocalDesignStore(window.localStorage)} />
);

async function openBlankDesignOnCanvas() {
  const user = userEvent.setup();
  render(localStudio());
  await user.click(await screen.findByText("New design"));
  await user.type(screen.getByPlaceholderText(/Design name/), "Air dock test");
  await user.click(screen.getByRole("button", { name: /Continue/ }));
  await user.click(screen.getByText("Blank canvas"));
  await user.click(await screen.findByRole("button", { name: "Design" }));
  await user.click(screen.getByRole("button", { name: /Split \(1:1\)/ }));
  const canvas = screen.getByTestId("studio-canvas");
  const svg = canvas.querySelector("svg")!;
  return { user, svg };
}

const pt = (x: number, y: number) => ({
  clientX: x,
  clientY: y,
  button: 0,
  pointerId: 1,
});

describe("air dock group (studio toolrail)", () => {
  beforeEach(() => window.localStorage.clear());

  it("Duct is parked until Step 4; Component gates on a served room first", async () => {
    await openBlankDesignOnCanvas();

    const duct = screen.getByRole("button", { name: "Duct" });
    expect(duct).toBeDisabled();
    expect(duct).toHaveAttribute("title", "Ductwork arrives at Step 4");

    const component = screen.getByRole("button", { name: "Component" });
    expect(component).toBeDisabled();
    expect(component).toHaveAttribute("title", "Component — add a room first");
  });

  it("with a room served, Component asks for a ducted indoor unit in plain words", async () => {
    const { user, svg } = await openBlankDesignOnCanvas();
    await armRoom(user);
    fireEvent.pointerDown(svg, pt(400, 300));
    fireEvent.pointerMove(svg, pt(456, 342));
    fireEvent.pointerUp(svg, pt(456, 342));
    await user.click(screen.getByRole("button", { name: "Save & continue" }));
    await user.click(screen.getByRole("button", { name: "No external walls" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    const component = screen.getByRole("button", { name: "Component" });
    expect(component).toBeDisabled();
    expect(component).toHaveAttribute(
      "title",
      "Component — needs a ducted indoor unit; wall and cassette units carry no ductwork"
    );
    /* the old wording said "air-capable air handler", which read as a
       different SYSTEM type and sent a real user hunting in the wrong place.
       The gate is about the UNIT — keep the word "ducted" in the message. */
    expect(component.getAttribute("title")).toContain("ducted");
    expect(component.getAttribute("title")).not.toContain("air-capable");
  });
});

describe("component palette", () => {
  it("ships all eight entries with only Plenum live, the rest naming their step", () => {
    expect(PALETTE_ENTRIES).toHaveLength(8);
    const onPick = jest.fn();
    render(<ComponentPalette onPick={onPick} onClose={() => {}} />);

    const enabled = ["Plenum"];
    for (const e of PALETTE_ENTRIES) {
      const btn = screen.getByRole("menuitem", { name: new RegExp(e.label) });
      if (enabled.includes(e.label)) {
        expect(btn).toBeEnabled();
      } else {
        expect(btn).toBeDisabled();
        expect(btn.textContent).toContain("coming — Step");
      }
    }
    // reasons match the build plan's steps
    expect(screen.getByRole("menuitem", { name: /Grille/ }).textContent).toContain("Step 3");
    expect(screen.getByRole("menuitem", { name: /Takeoff/ }).textContent).toContain("Step 4");
    expect(screen.getByRole("menuitem", { name: /Wall controller/ }).textContent).toContain("Step 5");
    expect(screen.getByRole("menuitem", { name: /Zone motor/ }).textContent).toContain("Step 6");

    fireEvent.click(screen.getByRole("menuitem", { name: /Plenum/ }));
    expect(onPick).toHaveBeenCalledWith("plenum");
    // disabled entries never pick
    fireEvent.click(screen.getByRole("menuitem", { name: /Grille/ }));
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and on an outside mousedown", () => {
    const onClose = jest.fn();
    render(<ComponentPalette onPick={() => {}} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("plenum options HUD", () => {
  it("toggles the armed stream", () => {
    const onStream = jest.fn();
    render(<PlenumHud stream="supply" onStream={onStream} returnBuiltIn={false} />);
    expect(screen.getByRole("button", { name: "Supply" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    fireEvent.click(screen.getByRole("button", { name: "Return" }));
    expect(onStream).toHaveBeenCalledWith("return");
  });

  it("disables the return side with its reason when the AHU's return is built in", () => {
    const onStream = jest.fn();
    render(<PlenumHud stream="supply" onStream={onStream} returnBuiltIn />);
    const ret = screen.getByRole("button", { name: "Return" });
    expect(ret).toBeDisabled();
    expect(ret).toHaveAttribute("title", "Return plenum is built into this air handler");
    fireEvent.click(ret);
    expect(onStream).not.toHaveBeenCalled();
  });
});
