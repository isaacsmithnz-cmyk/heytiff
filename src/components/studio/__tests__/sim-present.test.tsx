import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createDesign, type DesignDocument } from "@/lib/studio/document";
import { SimRuntime } from "@/lib/studio/sim-runtime";
import { SimPresentMode } from "../sim-present";

/* Present mode is the full-screen sim takeover. These check the SHELL and its
   exit wiring (portal, bar, Esc, Exit button, the plan canvas mounting) — the
   engine/overlay have their own suites. No pack needed: the presentation frame
   renders regardless of whether the sim has ready handlers. */

function baseDoc(): DesignDocument {
  const d = createDesign({ name: "14 Harbour View", mode: "blank", now: "2026-07-14T00:00:00.000Z" });
  d.floors = [
    { id: "flr", name: "Ground", level: 0, scaleMmPerUnit: 10, northDeg: null, northPos: null, simplePlan: null, plans: [] },
  ];
  d.systems = [
    { id: "sys1", type: "split", brand: "mitsubishi-electric", colour: "#2E68FF", name: "System 1", settings: {} },
  ];
  return d;
}

function renderPresent(onExit = jest.fn()) {
  const doc = baseDoc();
  const runtime = new SimRuntime(doc, null, "flr", 5);
  render(
    <SimPresentMode
      doc={doc}
      floor={doc.floors[0]}
      pack={null}
      activeSystemId="sys1"
      runtime={runtime}
      onExit={onExit}
    />
  );
  return { onExit };
}

it("renders a full-screen presentation frame with the design + system", () => {
  renderPresent();
  const dialog = screen.getByRole("dialog", { name: "Simulation presentation" });
  expect(dialog).toBeInTheDocument();
  // portalled to body, given the .fg/.dstudio scope so tokens + ds-* resolve
  expect(dialog).toHaveClass("fg", "dstudio", "ds-present");
  expect(screen.getByText("14 Harbour View")).toBeInTheDocument();
  expect(screen.getByText("System 1")).toBeInTheDocument();
  // the plan canvas mounts inside the stage
  expect(screen.getByTestId("studio-canvas")).toBeInTheDocument();
});

it("exits on the Exit button", async () => {
  const user = userEvent.setup();
  const { onExit } = renderPresent();
  await user.click(screen.getByRole("button", { name: "Exit" }));
  expect(onExit).toHaveBeenCalledTimes(1);
});

it("exits on Escape", () => {
  const { onExit } = renderPresent();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onExit).toHaveBeenCalledTimes(1);
});
