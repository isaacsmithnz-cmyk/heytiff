/* Repro: on a plan design with stored source plans, drawing a room and picking
   "No external walls" must still show the reference-sheets link in the room
   modal — same as when walls are marked. */

import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Studio } from "../studio";
import { createDesign } from "@/lib/studio/document";
import { LocalDesignStore } from "@/lib/studio/store";
import type { PlanImages } from "@/lib/studio/plans";

const fake: PlanImages = {
  upload: async () => "x",
  uploadSource: async () => "x",
  sourceFile: async () => new File([], "x"),
  url: async () => "data:image/png;base64,iVBORw0KGgo=",
  remove: async () => {},
};

const pt = (x: number, y: number) => ({ clientX: x, clientY: y, button: 0, pointerId: 1 });

async function openPlanDesignOnCanvas(scaleMmPerUnit: number | null) {
  const store = new LocalDesignStore(window.localStorage);
  const d = createDesign({ name: "Ref flow", mode: "plan" });
  d.floors = [
    { id: "flr", name: "Ground floor", level: 0, scaleMmPerUnit, northDeg: null, northPos: null, plans: [] },
  ];
  d.systems = [
    { id: "sys", type: "split", brand: "mitsubishi-electric", colour: "#2E68FF", name: "System 1", settings: {} },
  ];
  d.planImport = { sources: [{ ref: "org/o1/set.pdf", kind: "pdf" }], placed: {}, chosen: [], names: {} };
  await store.save(d);
  const user = userEvent.setup();
  render(<Studio store={store} planImages={fake} />);
  await user.click(await screen.findByText("Ref flow"));
  const svg = (await screen.findByTestId("studio-canvas")).querySelector("svg")!;
  return { user, svg };
}

describe("reference link across the wall-marking flow", () => {
  beforeEach(() => window.localStorage.clear());

  async function drawRoomNoWalls(user: Awaited<ReturnType<typeof openPlanDesignOnCanvas>>["user"], svg: SVGSVGElement) {
    await user.click(await screen.findByRole("button", { name: "Room (rectangle)" }));
    fireEvent.pointerDown(svg, pt(400, 300));
    fireEvent.pointerMove(svg, pt(456, 356));
    fireEvent.pointerUp(svg, pt(456, 356));
    await user.click(screen.getByRole("button", { name: "No external walls" }));
  }

  // the modal link's exact text (distinct from the canvas "Reference sheets" btn)
  const modalLink = () => screen.queryByText(/Height not on the plan/i);

  it("shows the modal reference link with a calibrated floor + no external walls", async () => {
    const { user, svg } = await openPlanDesignOnCanvas(10);
    await drawRoomNoWalls(user, svg);
    expect(modalLink()).toBeInTheDocument();
  });

  it("shows the modal reference link with an UNCALIBRATED floor + no external walls", async () => {
    const { user, svg } = await openPlanDesignOnCanvas(null);
    await drawRoomNoWalls(user, svg);
    expect(modalLink()).toBeInTheDocument();
  });
});
