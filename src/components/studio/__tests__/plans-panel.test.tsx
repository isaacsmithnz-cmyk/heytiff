/* Plans stage: floor management + the canvas plan-image layer, with the
   storage seam faked (the pdf.js raster path is browser-only). */

import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Studio } from "../studio";
import { createDesign, type DesignDocument } from "@/lib/studio/document";
import { LocalDesignStore } from "@/lib/studio/store";
import type { PlanImages } from "@/lib/studio/plans";

const ptc = (x: number, y: number) => ({ clientX: x, clientY: y, button: 0, pointerId: 1 });

const DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

class FakePlanImages implements PlanImages {
  removed: string[] = [];
  async upload(): Promise<string> {
    throw new Error("not used in tests");
  }
  async uploadSource(): Promise<string> {
    throw new Error("not used in tests");
  }
  async sourceFile(ref: string): Promise<File> {
    return new File(["%PDF"], ref, { type: "application/pdf" });
  }
  async url(): Promise<string> {
    return DATA_URL;
  }
  async remove(ref: string): Promise<void> {
    this.removed.push(ref);
  }
}

function seedDesign(store: LocalDesignStore): DesignDocument {
  const d = createDesign({ name: "Plan job", mode: "plan" });
  d.floors.push(
    {
      id: "flr_plan",
      name: "Ground floor",
      level: 0,
      scaleMmPerUnit: null,
      northDeg: null, northPos: null,
      plans: [
        {
          id: "sht_1",
          imageRef: "org/o1/p1.png",
          pageNumber: 1,
          name: "Ground floor",
          width: 1200,
          height: 900,
          x: 0,
          y: 0,
        },
      ],
    },
    {
      id: "flr_blank",
      name: "Sketch level",
      level: 1,
      scaleMmPerUnit: 10,
      northDeg: null, northPos: null,
      plans: [],
    }
  );
  void store.save(d);
  return d;
}

/* Plans lives behind the top-left studio menu now ("Edit plans") */
async function gotoPlans(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Studio menu" }));
  await user.click(screen.getByRole("menuitem", { name: "Edit plans" }));
}

/* the Design TAB shares its name with the floor-row Design buttons — scope
   to the step panel so [0] is the first floor row, never the tab */
const clickFloorDesign = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(
    within(document.querySelector(".ds-panel") as HTMLElement).getAllByRole(
      "button",
      { name: "Design" }
    )[0]
  );

async function openSeeded(planImages: PlanImages) {
  const store = new LocalDesignStore(window.localStorage);
  seedDesign(store);
  const user = userEvent.setup();
  render(<Studio store={store} planImages={planImages} />);
  await user.click(await screen.findByText("Plan job"));
  // a design that already has floors now opens straight on the canvas so you
  // resume where you left off — step back to Plans for the floor-list view
  await gotoPlans(user);
  return user;
}

describe("Plans stage", () => {
  beforeEach(() => window.localStorage.clear());

  it("lists floors with plan/scale status and supports rename; no blank floors in plan mode", async () => {
    const user = await openSeeded(new FakePlanImages());

    expect(screen.getByText("PDF p.1")).toBeInTheDocument();
    expect(screen.getByText("Not calibrated")).toBeInTheDocument();
    expect(screen.getByText("10.0 mm/px")).toBeInTheDocument();

    const name = screen.getByDisplayValue("Ground floor");
    await user.clear(name);
    await user.type(name, "GF (arch plans)");
    expect(screen.getByDisplayValue("GF (arch plans)")).toBeInTheDocument();

    // plan-mode designs can't have floors without drawings
    expect(screen.queryByRole("button", { name: "Blank floor" })).toBeNull();
  });

  it("blank-canvas designs keep the Blank floor button", async () => {
    const store = new LocalDesignStore(window.localStorage);
    void store.save(createDesign({ name: "Sketch job", mode: "blank" }));
    const user = userEvent.setup();
    render(<Studio store={store} planImages={new FakePlanImages()} />);
    await user.click(await screen.findByText("Sketch job"));

    // blank designs open on the canvas; the floor tools live on the Plans step
    await gotoPlans(user);
    await user.click(screen.getByRole("button", { name: "Blank floor" }));
    expect(screen.getByDisplayValue("Level 1")).toBeInTheDocument();
  });

  it("Design button opens that floor on the canvas with the plan image under the grid", async () => {
    const user = await openSeeded(new FakePlanImages());

    await clickFloorDesign(user);
    const canvas = await screen.findByTestId("studio-canvas");
    await waitFor(() => {
      const img = canvas.querySelector("image.ds-plan");
      expect(img).not.toBeNull();
      expect(img!.getAttribute("width")).toBe("1200");
      expect(img!.getAttribute("href")).toBe(DATA_URL);
    });
    // uncalibrated plan floor: the merged Calibrate pill is present and not yet complete
    const calibPill = screen.getByTitle("Calibrate — set the scale and north");
    expect(calibPill).toBeInTheDocument();
    expect(calibPill.className).not.toMatch(/\bdone\b/);
  });

  it("opening an uncalibrated plan floor pops the Calibrate step, which arms the tool", async () => {
    const user = await openSeeded(new FakePlanImages());
    await clickFloorDesign(user);
    await screen.findByTestId("studio-canvas");
    // the guided-step popup, not a silent tool arm
    expect(await screen.findByText("Calibrate the plan")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Calibrate scale →" }));
    expect(screen.queryByText("Calibrate the plan")).not.toBeInTheDocument();
    // the calibrate tool is now armed — the merged Calibrate pill shows it active
    expect(
      screen.getByTitle("Calibrate — set the scale and north").className
    ).toMatch(/\bon\b/);
  });

  it("confirming the scale chains into the Set-north step popup", async () => {
    const user = await openSeeded(new FakePlanImages());
    await clickFloorDesign(user);
    const canvas = await screen.findByTestId("studio-canvas");
    const svg = canvas.querySelector("svg")!;
    await user.click(await screen.findByRole("button", { name: "Calibrate scale →" }));
    // two calibration clicks, then a real distance → Set scale
    fireEvent.pointerDown(svg, ptc(200, 150));
    fireEvent.pointerUp(svg, ptc(200, 150));
    fireEvent.pointerDown(svg, ptc(400, 150));
    fireEvent.pointerUp(svg, ptc(400, 150));
    await user.type(screen.getByPlaceholderText("e.g. 3.6"), "5");
    await user.click(screen.getByText("Set scale"));
    // the north step popup appears
    expect(await screen.findByText("Set north direction")).toBeInTheDocument();
  });

  it("B&W toggle applies a grayscale filter to the plan image", async () => {
    const user = await openSeeded(new FakePlanImages());
    await clickFloorDesign(user);
    const canvas = await screen.findByTestId("studio-canvas");
    await waitFor(() => expect(canvas.querySelector("image.ds-plan")).not.toBeNull());
    await user.click(await screen.findByRole("button", { name: "Skip for now" }));

    await user.click(screen.getByRole("button", { name: /View/ }));
    await user.click(screen.getByRole("checkbox", { name: "Black & white" }));
    const img = canvas.querySelector("image.ds-plan")!;
    expect(img.getAttribute("style") ?? "").toMatch(/grayscale/);
  });

  it("the crop tool clips the plan sheet to the dragged rect", async () => {
    const user = await openSeeded(new FakePlanImages());
    await clickFloorDesign(user);
    const canvas = await screen.findByTestId("studio-canvas");
    await waitFor(() => expect(canvas.querySelector("image.ds-plan")).not.toBeNull());
    await user.click(await screen.findByRole("button", { name: "Skip for now" }));
    const svg = canvas.querySelector("svg")!;

    // crop now lives in the Calibrate dropdown (plan-prep), not the tool rail
    await user.click(screen.getByTitle("Calibrate — set the scale and north"));
    await user.click(screen.getByRole("button", { name: /Crop/ }));
    // drag a rect inside the 1200×900 sheet (screen ≈ 80,60 → 720,540)
    fireEvent.pointerDown(svg, ptc(200, 150));
    fireEvent.pointerMove(svg, ptc(400, 300));
    fireEvent.pointerUp(svg, ptc(400, 300));

    await waitFor(() => {
      expect(canvas.querySelector("clipPath")).not.toBeNull();
      expect(canvas.querySelector("image.ds-plan")!.getAttribute("clip-path")).toMatch(/url\(#clip-/);
    });
  });

  it("Fit frames the cropped region, so it no longer over-zooms out", async () => {
    const user = await openSeeded(new FakePlanImages());
    await clickFloorDesign(user);
    const canvas = await screen.findByTestId("studio-canvas");
    await waitFor(() => expect(canvas.querySelector("image.ds-plan")).not.toBeNull());
    await user.click(await screen.findByRole("button", { name: "Skip for now" }));
    const svg = canvas.querySelector("svg")!;

    const zoomGroup = screen.getByRole("group", { name: "Zoom" });
    const readZoom = () => parseInt(zoomGroup.querySelector("span")!.textContent!, 10);

    // fit the whole 1200×900 sheet first
    await user.click(screen.getByRole("button", { name: "Fit to content" }));
    const zFull = readZoom();

    // crop to a sub-rect (Crop lives in the Calibrate dropdown now), then re-fit
    await user.click(screen.getByTitle("Calibrate — set the scale and north"));
    await user.click(screen.getByRole("button", { name: /Crop/ }));
    fireEvent.pointerDown(svg, ptc(200, 150));
    fireEvent.pointerMove(svg, ptc(400, 300));
    fireEvent.pointerUp(svg, ptc(400, 300));
    await waitFor(() => expect(canvas.querySelector("clipPath")).not.toBeNull());

    await user.click(screen.getByRole("button", { name: "Fit to content" }));
    // the crop is a fraction of the sheet, so fitting it zooms in, not way out
    expect(readZoom()).toBeGreaterThan(zFull);
  });

  it("the Calibrate dropdown carries the relocated Crop + Move plans tools", async () => {
    const user = await openSeeded(new FakePlanImages());
    await clickFloorDesign(user);
    await screen.findByTestId("studio-canvas");
    await user.click(await screen.findByRole("button", { name: "Skip for now" }));

    await user.click(screen.getByTitle("Calibrate — set the scale and north"));
    expect(screen.getByRole("button", { name: /Crop/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Move plans/ })).toBeInTheDocument();
  });

  it("renders every sheet of a multi-sheet floor at its stored offset", async () => {
    const store = new LocalDesignStore(window.localStorage);
    const d = seedDesign(store);
    d.floors[0].plans.push({
      id: "sht_2",
      imageRef: "org/o1/p2.png",
      pageNumber: 2,
      name: "Ground west",
      width: 1000,
      height: 900,
      x: 1260,
      y: 40,
    });
    await store.save(d);
    const user = userEvent.setup();
    render(<Studio store={store} planImages={new FakePlanImages()} />);
    await user.click(await screen.findByText("Plan job"));
    // opens on the canvas now — step back to Plans for the floor list
    await gotoPlans(user);

    expect(screen.getByText("2 sheets")).toBeInTheDocument();

    await clickFloorDesign(user);
    const canvas = await screen.findByTestId("studio-canvas");
    await waitFor(() => {
      const images = canvas.querySelectorAll("image.ds-plan");
      expect(images).toHaveLength(2);
      expect(images[0].getAttribute("x")).toBe("0");
      expect(images[1].getAttribute("x")).toBe("1260");
      expect(images[1].getAttribute("y")).toBe("40");
    });
  });

  it("a design with floors reopens on the canvas, not the Plans step", async () => {
    const store = new LocalDesignStore(window.localStorage);
    seedDesign(store);
    const user = userEvent.setup();
    render(<Studio store={store} planImages={new FakePlanImages()} />);
    await user.click(await screen.findByText("Plan job"));

    // lands straight on the canvas so you resume where you were working
    expect(await screen.findByTestId("studio-canvas")).toBeInTheDocument();
    // ...and the floor switcher trigger shows the current STACK LEVEL (GF/L1), not
    // the typed name; opening the dropdown lists all floors
    const floorTrigger = screen.getByRole("button", { name: /^(GF|L1)$/ });
    expect(floorTrigger).toBeInTheDocument();
    await user.click(floorTrigger);
    expect(screen.getByRole("button", { name: "Delete Ground floor" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Sketch level" })).toBeInTheDocument();
  });

  it("stepping back to Plans shows the committed floors, not an empty uploader", async () => {
    const user = await openSeeded(new FakePlanImages());
    // the floor list is present (committed work), and the empty import stepper
    // sections are not shown over the top of it
    expect(screen.getByDisplayValue("Ground floor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add plans/ })).toBeInTheDocument();
    expect(screen.queryByText("Drop floor plans here")).toBeNull();
  });

  it("the canvas offers Reference sheets when the design has an uploaded plan set", async () => {
    const store = new LocalDesignStore(window.localStorage);
    const d = createDesign({ name: "Ref job", mode: "plan" });
    d.floors.push({
      id: "flr_r",
      name: "Ground floor",
      level: 0,
      scaleMmPerUnit: 10,
      northDeg: null, northPos: null,
      plans: [],
    });
    d.planImport = { sources: [{ ref: "org/o1/set.pdf", kind: "pdf" }], placed: {}, chosen: [], names: {} };
    await store.save(d);
    const user = userEvent.setup();
    render(<Studio store={store} planImages={new FakePlanImages()} />);
    await user.click(await screen.findByText("Ref job"));

    // opens on the canvas; Reference sheets lives in the studio menu now
    await user.click(await screen.findByRole("button", { name: "Studio menu" }));
    await user.click(screen.getByRole("menuitem", { name: "Reference sheets" }));
    expect(await screen.findByTitle("Reference PDF")).toBeInTheDocument();
  });

  it("deletes the active floor from the canvas (two-step confirm)", async () => {
    const store = new LocalDesignStore(window.localStorage);
    const d = createDesign({ name: "Del job", mode: "plan" });
    d.floors.push(
      { id: "flr_g", name: "Ground floor", level: 0, scaleMmPerUnit: 10, northDeg: null, northPos: null, plans: [] },
      { id: "flr_1", name: "Level 1", level: 1, scaleMmPerUnit: 10, northDeg: null, northPos: null, plans: [] }
    );
    await store.save(d);
    const user = userEvent.setup();
    render(<Studio store={store} planImages={new FakePlanImages()} />);
    await user.click(await screen.findByText("Del job"));

    // on the canvas: open the floor dropdown — both floors listed
    await user.click(await screen.findByRole("button", { name: /^(GF|L1)$/ }));
    expect(screen.getByRole("button", { name: "Delete Ground floor" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Level 1" })).toBeInTheDocument();

    // arm then confirm delete of the ground floor (two-step "Are you sure?")
    await user.click(screen.getByRole("button", { name: "Delete Ground floor" }));
    await user.click(screen.getByRole("button", { name: "Delete?" }));

    // Ground floor is gone; only Level 1 remains (its delete x is hidden — last floor)
    expect(screen.queryByRole("button", { name: "Delete Ground floor" })).toBeNull();
    expect(screen.getByRole("button", { name: "L1" })).toBeInTheDocument();
  });

  it("deleting a floor removes it and its stored plan image", async () => {
    const fake = new FakePlanImages();
    const user = await openSeeded(fake);

    const del = screen.getByRole("button", { name: "Delete Ground floor" });
    await user.click(del); // arm
    await user.click(screen.getByRole("button", { name: "Delete Ground floor" }));
    expect(screen.queryByDisplayValue("Ground floor")).not.toBeInTheDocument();
    await waitFor(() => expect(fake.removed).toEqual(["org/o1/p1.png"]));
  });
});
