/* Ducted Step 2 — the air dock group, its spec-§2 gating, the component
   palette (eight entries, only Plenum live) and the options-HUD plenum
   variant. The dock gating runs through the full Studio (no pack loads under
   jsdom, so the air-capable-AHU gate stays honestly shut); the palette + HUD
   are driven directly. */

import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Studio } from "../studio";
import { ComponentPalette, PlenumHud, PALETTE_ENTRIES } from "../air-tools";
import { LocalDesignStore } from "@/lib/studio/store";

/* The Zone tool lives on the canvas toolbar — one button, the shape choice
   flies out on click. */
async function armRoom(
  user: ReturnType<typeof userEvent.setup>,
  shape: "Rectangle" | "Polygon" = "Rectangle"
) {
  await user.click(await screen.findByRole("button", { name: "Zone" }));
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
  await user.click(screen.getByRole("button", { name: "Start with a blank canvas" }));
  await user.click(await screen.findByRole("button", { name: "Design" }));
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

  /* Duct lives in the Draw flyout now, not on the bench: it is linework like
     everything else in there, and a permanently disabled BUTTON was holding a
     whole verb's width on a bar that had started wrapping on a laptop. It is
     still signposted — a named row that is plainly not ready beats a verb
     missing from the list with nothing to explain the gap. */
  it("Duct is drawn from the Draw flyout: supply or return, and its size", async () => {
    const { user } = await openBlankDesignOnCanvas();

    // gone from the bench itself
    expect(screen.queryByRole("button", { name: "Duct" })).toBeNull();

    // Draw draws for a system
    await user.click(screen.getByRole("button", { name: "Add a system" }));
    await user.click(screen.getByRole("button", { name: "Draw" }));
    expect(screen.getByRole("menu", { name: "Draw a line" })).toBeInTheDocument();
    const ductRow = () => within(screen.getByRole("menu", { name: "Draw a line" })).getByText("Duct").closest(".ds-drawrow") as HTMLElement;
    await user.click(within(ductRow()).getByRole("menuitemradio", { name: "Ø300" }));
    // armed: the flyout folds; open again, the duct's picks are the ones on
    expect(screen.queryByRole("menu", { name: "Draw a line" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Draw" }));
    expect(within(ductRow()).getByRole("menuitemradio", { name: "Ø300" })).toHaveAttribute("aria-checked", "true");
    expect(within(ductRow()).getByRole("menuitemradio", { name: "Supply" })).toHaveAttribute("aria-checked", "true");
  });

  it("Component gates on a system, then on a zone it serves", async () => {
    const { user } = await openBlankDesignOnCanvas();

    const component = screen.getByRole("button", { name: "Component" });
    expect(component).toBeDisabled();
    expect(component).toHaveAccessibleDescription("Pick a system first");

    await user.click(screen.getByRole("button", { name: "Add a system" }));
    expect(component).toBeDisabled();
    expect(component).toHaveAccessibleDescription("Add a zone first");
  });

  it("with a zone served, Component asks for a ducted indoor unit in plain words", async () => {
    const { user, svg } = await openBlankDesignOnCanvas();
    await armRoom(user);
    fireEvent.pointerDown(svg, pt(400, 300));
    fireEvent.pointerMove(svg, pt(456, 342));
    fireEvent.pointerUp(svg, pt(456, 342));
    await user.click(screen.getByRole("button", { name: "Save & continue" }));
    await user.click(screen.getByRole("button", { name: "No external walls" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    // a system, given the zone from the panel's Zones without a system
    await user.click(screen.getByRole("button", { name: "Add a system" }));
    await user.click(screen.getByRole("button", { name: "Add zones" }));
    await user.click(screen.getByRole("button", { name: "Add Zone 1 to System 1" }));

    const component = screen.getByRole("button", { name: "Component" });
    expect(component).toBeDisabled();
    expect(component).toHaveAccessibleDescription(
      "Needs a ducted indoor unit; wall and cassette units carry no ductwork"
    );
    /* the old wording said "air-capable air handler", which read as a
       different SYSTEM type and sent a real user hunting in the wrong place.
       The gate is about the UNIT — keep the word "ducted" in the message. */
    expect(component).toHaveAccessibleDescription(/ducted/);
    expect(component).not.toHaveAccessibleDescription(/air-capable/);
  });
});

describe("component palette", () => {
  it("shows only what is built: Plenum and Grille, never a build-plan step", () => {
    expect(PALETTE_ENTRIES).toHaveLength(8);
    const onPick = jest.fn();
    render(<ComponentPalette onPick={onPick} onClose={() => {}} />);
    expect(screen.getAllByRole("menuitem").map((b) => b.textContent)).toEqual(["Plenum", "Grille"]);
    expect(screen.queryByText(/coming/)).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: /Plenum/ }));
    expect(onPick).toHaveBeenCalledWith("plenum");
    fireEvent.click(screen.getByRole("menuitem", { name: /Grille/ }));
    expect(onPick).toHaveBeenLastCalledWith("grille");
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
    expect(ret).toHaveAccessibleDescription("Return plenum is built into this air handler");
    fireEvent.click(ret);
    expect(onStream).not.toHaveBeenCalled();
  });
});
