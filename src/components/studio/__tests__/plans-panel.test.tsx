/* Plans stage: floor management + the canvas plan-image layer, with the
   storage seam faked (the pdf.js raster path is browser-only). */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Studio } from "../studio";
import { createDesign, type DesignDocument } from "@/lib/studio/document";
import { LocalDesignStore } from "@/lib/studio/store";
import type { PlanImages } from "@/lib/studio/plans";

const DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

class FakePlanImages implements PlanImages {
  removed: string[] = [];
  async upload(): Promise<string> {
    throw new Error("not used in tests");
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
      northDeg: null,
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
      northDeg: null,
      plans: [],
    }
  );
  void store.save(d);
  return d;
}

async function openSeeded(planImages: PlanImages) {
  const store = new LocalDesignStore(window.localStorage);
  seedDesign(store);
  const user = userEvent.setup();
  render(<Studio store={store} planImages={planImages} />);
  await user.click(await screen.findByText("Plan job"));
  return user;
}

describe("Plans stage", () => {
  beforeEach(() => window.localStorage.clear());

  it("lists floors with plan/scale status and supports rename + add blank floor", async () => {
    const user = await openSeeded(new FakePlanImages());

    expect(screen.getByText("PDF p.1")).toBeInTheDocument();
    expect(screen.getByText("Not calibrated")).toBeInTheDocument();
    expect(screen.getByText("10.0 mm/px")).toBeInTheDocument();

    const name = screen.getByDisplayValue("Ground floor");
    await user.clear(name);
    await user.type(name, "GF (arch plans)");
    expect(screen.getByDisplayValue("GF (arch plans)")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Blank floor" }));
    expect(screen.getByDisplayValue("Level 2")).toBeInTheDocument();
  });

  it("Design button opens that floor on the canvas with the plan image under the grid", async () => {
    const user = await openSeeded(new FakePlanImages());

    await user.click(screen.getAllByRole("button", { name: "Design" })[0]);
    const canvas = await screen.findByTestId("studio-canvas");
    await waitFor(() => {
      const img = canvas.querySelector("image.ds-plan");
      expect(img).not.toBeNull();
      expect(img!.getAttribute("width")).toBe("1200");
      expect(img!.getAttribute("href")).toBe(DATA_URL);
    });
    // uncalibrated plan floor warns
    expect(screen.getByText(/Not calibrated — sizes are arbitrary/)).toBeInTheDocument();
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

    expect(screen.getByText("2 sheets")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Design" })[0]);
    const canvas = await screen.findByTestId("studio-canvas");
    await waitFor(() => {
      const images = canvas.querySelectorAll("image.ds-plan");
      expect(images).toHaveLength(2);
      expect(images[0].getAttribute("x")).toBe("0");
      expect(images[1].getAttribute("x")).toBe("1260");
      expect(images[1].getAttribute("y")).toBe("40");
    });
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
