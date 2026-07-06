/* Installer scenario pass — the upload → floors journey end-to-end, driven
   through the real panel UI. Only the pdf.js raster step is mocked (jsdom
   can't run it); everything downstream — picking, naming, stacking,
   uploading, committing floors — is the production code path. */

import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Studio } from "../studio";
import { createDesign } from "@/lib/studio/document";
import { LocalDesignStore } from "@/lib/studio/store";
import type { PageImage, PlanImages } from "@/lib/studio/plans";

jest.mock("@/lib/studio/plans", () => ({
  ...jest.requireActual("@/lib/studio/plans"),
  pdfToPages: jest.fn(),
  imageToPage: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pdfToPages } = require("@/lib/studio/plans") as {
  pdfToPages: jest.Mock;
};

const page = (label: string, n: number): PageImage => ({
  pageNumber: n,
  label,
  blob: new Blob(["x"], { type: "image/png" }),
  ext: "png",
  thumbUrl: `blob:page-${n}`,
  width: 2000,
  height: 1400,
});

class CountingPlanImages implements PlanImages {
  uploads = 0;
  removed: string[] = [];
  async upload(): Promise<string> {
    this.uploads += 1;
    return `org/o1/up_${this.uploads}.png`;
  }
  async url(): Promise<string> {
    return "data:image/png;base64,iVBORw0KGgo=";
  }
  async remove(ref: string): Promise<void> {
    this.removed.push(ref);
  }
}

async function openPlanJob(fake: PlanImages) {
  const store = new LocalDesignStore(window.localStorage);
  const d = createDesign({ name: "Job", mode: "plan" });
  await store.save(d);
  const user = userEvent.setup();
  render(<Studio store={store} planImages={fake} />);
  await user.click(await screen.findByText("Job"));
  return user;
}

function uploadPdf() {
  const input = document.querySelector('input[type="file"]')!;
  fireEvent.change(input, {
    target: { files: [new File(["%PDF"], "plans.pdf", { type: "application/pdf" })] },
  });
}

/** Step through the naming lightbox, optionally renaming, then continue. */
async function nameFloors(user: ReturnType<typeof userEvent.setup>, names: (string | null)[]) {
  for (let i = 0; i < names.length; i++) {
    const rename = names[i];
    const input = await screen.findByLabelText("Floor name"); // wait for the step
    if (rename !== null) {
      await user.clear(input);
      await user.type(input, rename);
    }
    await user.click(
      screen.getByRole("button", {
        name: i === names.length - 1 ? "Continue to stacking" : "Next floor",
      })
    );
  }
}

const dropPayload = (data: string) => ({ dataTransfer: { getData: () => data } });

/* yard drop-target helpers (the stack is drag-driven) */
const yardFirst = () => document.querySelector(".ds-yard-first") as HTMLElement;
const floorCard = (name: string) =>
  document.querySelector(`[data-floor="${name}"]`) as HTMLElement;
const gapAbove = (name: string) =>
  floorCard(name).previousElementSibling as HTMLElement;
const subfloorGap = () => {
  const gaps = document.querySelectorAll(".ds-yard .ds-yard-gap");
  return gaps[gaps.length - 1] as HTMLElement;
};
const dropPage = (el: Element, idx: number) => fireEvent.drop(el, dropPayload(`p:${idx}`));

/* "Start design" commits the floors and jumps straight to the canvas; going
   back to the Plans step surfaces the committed floor list for assertions */
async function startDesignThenReviewPlans(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Start design/ }));
  expect(await screen.findByTestId("studio-canvas")).toBeInTheDocument();
  // the completed Plans step shows a check (no number) → name is just "Plans"
  await user.click(screen.getByRole("button", { name: /Plans/ }));
}

describe("installer scenarios: upload → floors", () => {
  beforeEach(() => {
    window.localStorage.clear();
    pdfToPages.mockReset();
  });

  it("single-storey reno: a 1-page PDF skips the picker entirely (no pointless selection step)", async () => {
    pdfToPages.mockResolvedValue([page("Floor plan", 1)]);
    const fake = new CountingPlanImages();
    const user = await openPlanJob(fake);

    uploadPdf();
    // straight into naming — no picker; pages come in unnamed as "Page 1"
    expect(await screen.findByLabelText("Floor name")).toHaveValue("Page 1");
    expect(screen.queryByText("Click the pages you want to upload")).toBeNull();

    await nameFloors(user, ["Ground floor"]);
    // on the stack: the named page waits in the tray; Add is gated until placed
    expect(await screen.findByText("Stack your floors")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Start design/ })).toBeDisabled();
    expect(within(document.querySelector(".ds-yard") as HTMLElement).queryByRole("textbox")).toBeNull();

    // drop it into the yard → it becomes the ground floor
    dropPage(yardFirst(), 0);
    expect(floorCard("Ground floor")).toBeInTheDocument();
    expect(screen.getByText("GF")).toBeInTheDocument();

    // "Start design" commits and jumps straight to the canvas on that floor
    await user.click(screen.getByRole("button", { name: /Start design/ }));
    expect(await screen.findByTestId("studio-canvas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ground floor/ })).toBeInTheDocument(); // floor tab
    expect(fake.uploads).toBe(1);

    // the floor still lives on the (now-completed) Plans step
    await user.click(screen.getByRole("button", { name: /Plans/ }));
    expect(screen.getByDisplayValue("Ground floor")).toBeInTheDocument();
  });

  it("two-storey house from a 4-page set: junk sheets skipped and never uploaded", async () => {
    pdfToPages.mockResolvedValue([
      page("Site plan", 1),
      page("Ground floor", 2),
      page("Level 1", 3),
      page("Elevations", 4),
    ]);
    const fake = new CountingPlanImages();
    const user = await openPlanJob(fake);

    uploadPdf();
    // floors list must be hidden while importing
    expect(await screen.findByText("Click the pages you want to upload")).toBeInTheDocument();
    expect(screen.queryByText("Floors")).toBeNull();

    // pages come in as "Page 1..4"; skip the site plan (1) and elevations (4)
    await user.click(screen.getByRole("button", { name: "Page 2" }));
    await user.click(screen.getByRole("button", { name: "Page 3" }));
    await user.click(screen.getByRole("button", { name: /Continue with 2 pages/ }));
    await nameFloors(user, ["Ground floor", "Level 1"]);

    // place ground floor first, then Level 1 in the gap above it
    dropPage(yardFirst(), 1);
    dropPage(gapAbove("Ground floor"), 2);
    // the anchor card carries the level dropdown (GF); the one above derives L1
    expect(screen.getByLabelText("Level for Ground floor")).toHaveValue("0");
    expect(floorCard("Level 1").querySelector(".ds-floor-lvl")!.textContent).toBe("L1");

    await startDesignThenReviewPlans(user);
    expect(screen.getByDisplayValue("Level 1")).toBeInTheDocument();
    // only the two chosen pages were uploaded — site plan/elevations never left the browser
    expect(fake.uploads).toBe(2);
  });

  it("commercial job: L2 split east/west merges onto one floor; basement drops below the ground line", async () => {
    pdfToPages.mockResolvedValue([
      page("Basement", 1),
      page("Ground floor", 2),
      page("Level 2 East", 3),
      page("Level 2 West", 4),
    ]);
    const fake = new CountingPlanImages();
    const user = await openPlanJob(fake);

    uploadPdf();
    for (const name of ["Page 1", "Page 2", "Page 3", "Page 4"]) {
      await user.click(await screen.findByRole("button", { name }));
    }
    await user.click(screen.getByRole("button", { name: /Continue with 4 pages/ }));
    // both split sheets share the name "Level 2" (display only); position rules
    await nameFloors(user, ["Basement", "Ground floor", "Level 2", "Level 2"]);

    // build the stack by dragging from the tray
    dropPage(yardFirst(), 1); // Ground floor → GF
    dropPage(gapAbove("Ground floor"), 2); // Level 2 East → the level above (L1)
    dropPage(floorCard("Level 2"), 3); // West merged onto the Level 2 card
    dropPage(subfloorGap(), 0); // Basement below the ground line → B1

    // one Level 2 floor now holds two sheets
    const merged = floorCard("Level 2");
    expect(merged.querySelectorAll(".ds-floorcard-sheet")).toHaveLength(2);

    await startDesignThenReviewPlans(user);
    expect(screen.getByDisplayValue("Basement")).toBeInTheDocument();
    expect(fake.uploads).toBe(4);
    // floor list: B1 basement, GF, L1 = the merged Level 2 with two sheets
    expect(screen.getByText("B1")).toBeInTheDocument();
    expect(screen.getByText("GF")).toBeInTheDocument();
    expect(screen.getByText("L1")).toBeInTheDocument();
    expect(screen.getByText("2 sheets")).toBeInTheDocument();
  });

  it("west wing arrives later: single page drops onto the EXISTING floor — no new floor created", async () => {
    pdfToPages.mockResolvedValue([page("GF West", 1)]);
    const fake = new CountingPlanImages();
    const user = await openPlanJob(fake);

    // first import creates the floor; the second must join it, not duplicate
    uploadPdf();
    await nameFloors(user, ["Ground floor"]);
    dropPage(yardFirst(), 0); // place as ground floor
    await startDesignThenReviewPlans(user);
    expect(screen.getByDisplayValue("Ground floor")).toBeInTheDocument();

    // second import: the existing floor shows in the yard as a fixed card
    pdfToPages.mockResolvedValue([page("GF West wing", 1)]);
    uploadPdf();
    await nameFloors(user, [null]);
    const existing = floorCard("Ground floor");
    expect(existing.className).toContain("existing");
    dropPage(existing, 0); // merge the west wing onto it

    await startDesignThenReviewPlans(user);
    expect(screen.getByText("2 sheets")).toBeInTheDocument();
    // still exactly one floor
    expect(screen.getAllByDisplayValue("Ground floor")).toHaveLength(1);
    expect(fake.uploads).toBe(2);
  });

  it("back-navigation never loses typed names (no retyping = no double handling)", async () => {
    pdfToPages.mockResolvedValue([page("Page 1", 1), page("Page 2", 2)]);
    const user = await openPlanJob(new CountingPlanImages());

    uploadPdf();
    await user.click(await screen.findByRole("button", { name: "Page 1" }));
    await user.click(screen.getByRole("button", { name: "Page 2" }));
    await user.click(screen.getByRole("button", { name: /Continue with 2 pages/ }));

    const input = await screen.findByLabelText("Floor name");
    await user.clear(input);
    await user.type(input, "Ground floor (verified)");

    // back to the picker, then continue again — the typed name must survive
    await user.click(screen.getByRole("button", { name: "Back to pages" }));
    await user.click(screen.getByRole("button", { name: /Continue with 2 pages/ }));
    expect(await screen.findByLabelText("Floor name")).toHaveValue(
      "Ground floor (verified)"
    );
  });

  it("junk file: clear error, flow resets, floor management returns", async () => {
    const user = await openPlanJob(new CountingPlanImages());
    const input = document.querySelector('input[type="file"]')!;
    fireEvent.change(input, {
      target: { files: [new File(["hi"], "notes.txt", { type: "text/plain" })] },
    });
    expect(await screen.findByText(/No usable pages/)).toBeInTheDocument();
    // idle again: upload zone + floors section both present
    expect(screen.getByText("Drop floor plans here")).toBeInTheDocument();
    expect(screen.getByText("Floors")).toBeInTheDocument();
    expect(user).toBeTruthy();
  });

  it("plan-mode Design step with no floors points to Plans — no blank-floor escape hatch", async () => {
    const user = await openPlanJob(new CountingPlanImages());
    await user.click(screen.getByRole("button", { name: "2 Design" }));
    expect(screen.getByText("No floors yet")).toBeInTheDocument();
    expect(screen.queryByText("Add a blank floor")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Go to Plans/ }));
    expect(screen.getByText("Drop floor plans here")).toBeInTheDocument();
  });

  it("picker: clicking a card selects it; the expand button opens the preview (not a select)", async () => {
    pdfToPages.mockResolvedValue([page("a", 1), page("b", 2), page("c", 3)]);
    const user = await openPlanJob(new CountingPlanImages());
    uploadPdf();

    // clicking the card body toggles selection — no magnifying glass needed
    const card = await screen.findByRole("button", { name: "Page 2" });
    expect(card).toHaveAttribute("aria-pressed", "false");
    await user.click(card);
    expect(screen.getByRole("button", { name: "Page 2" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByText("1 of 3 selected")).toBeInTheDocument();

    // the expand button opens the full-size lightbox and does NOT toggle
    await user.click(screen.getByRole("button", { name: "Preview Page 3" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Page 3")).toBeInTheDocument();
    // still only page 2 selected — previewing page 3 didn't select it
    expect(screen.getByText("1 of 3 selected")).toBeInTheDocument();
  });

  it("basement job: change the first plan's level dropdown and the stack re-pins", async () => {
    pdfToPages.mockResolvedValue([page("Carpark", 1), page("Plant room", 2)]);
    const fake = new CountingPlanImages();
    const user = await openPlanJob(fake);

    uploadPdf();
    await user.click(await screen.findByRole("button", { name: "Page 1" }));
    await user.click(screen.getByRole("button", { name: "Page 2" }));
    await user.click(screen.getByRole("button", { name: /Continue with 2 pages/ }));
    await nameFloors(user, ["Carpark", "Plant room"]);

    dropPage(yardFirst(), 0); // Carpark lands as the anchor (GF by default)
    dropPage(gapAbove("Carpark"), 1); // Plant room above it
    // re-pin the anchor: this is actually basement level 2
    await user.selectOptions(screen.getByLabelText("Level for Carpark"), "-2");
    expect(floorCard("Plant room").querySelector(".ds-floor-lvl")!.textContent).toBe("B1");

    await startDesignThenReviewPlans(user);
    expect(screen.getByDisplayValue("Carpark")).toBeInTheDocument();
    // committed with the re-pinned levels
    expect(screen.getByText("B2")).toBeInTheDocument();
    expect(screen.getByText("B1")).toBeInTheDocument();
    expect(fake.uploads).toBe(2);
  });

  it("picker shows the AI-screening slot (disabled placeholder for now)", async () => {
    pdfToPages.mockResolvedValue([page("a", 1), page("b", 2)]);
    const user = await openPlanJob(new CountingPlanImages());
    uploadPdf();
    await screen.findByText("Click the pages you want to upload");
    const ai = screen.getByRole("button", { name: /AI screening/ });
    expect(ai).toBeDisabled();
    expect(user).toBeTruthy();
  });
});
