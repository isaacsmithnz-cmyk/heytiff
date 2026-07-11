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
  uploads = 0; // rendered PAGE images (only placed pages get one)
  sourceUploads = 0; // original source files
  removed: string[] = [];
  async upload(): Promise<string> {
    this.uploads += 1;
    return `org/o1/up_${this.uploads}.png`;
  }
  async uploadSource(): Promise<string> {
    this.sourceUploads += 1;
    return `org/o1/src_${this.sourceUploads}.pdf`;
  }
  async sourceFile(ref: string): Promise<File> {
    // pdfToPages is mocked, so the bytes are irrelevant — only the ref matters
    return new File(["%PDF"], ref, { type: "application/pdf" });
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
    const input = await screen.findByLabelText("Page name"); // wait for the step
    if (rename !== null) {
      await user.clear(input);
      await user.type(input, rename);
    }
    await user.click(
      screen.getByRole("button", {
        name: i === names.length - 1 ? "Continue to stacking" : "Next page",
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
  const gaps = document.querySelectorAll(".ds-yard .ds-dropzone");
  return gaps[gaps.length - 1] as HTMLElement;
};
const dropPage = (el: Element, idx: number) => fireEvent.drop(el, dropPayload(`p:${idx}`));

/* the committed-floor admin list — levels appear here AND on the rebuilt
   stacker, so level assertions scope to this to stay unambiguous */
const floorsList = () => document.querySelector(".ds-floors") as HTMLElement;

/* "Start design" commits the floors and jumps straight to the canvas; going
   back to the Plans step restores the saved session (the stacker rebuilds
   asynchronously), and the committed-floor list sits beneath it */
async function startDesignThenReviewPlans(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Start design/ }));
  expect(await screen.findByTestId("studio-canvas")).toBeInTheDocument();
  // the completed Plans step shows a check (no number) → name is just "Plans"
  await user.click(screen.getByRole("button", { name: /Plans/ }));
  // the restored session rehydrates from storage — wait for the rebuilt stacker
  await screen.findByText("Stack your floors");
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
    // straight into naming — the single page is auto-selected, no Continue
    // click needed; the name starts EMPTY (defaults to the floor's stack
    // position, not the plan's "Page 1" label)
    expect(await screen.findByLabelText("Page name")).toHaveValue("");
    expect(screen.getByText("1 of 1 selected")).toBeInTheDocument();

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
    // the floor switcher tab reads the stack LEVEL (GF), with the name on hover
    expect(screen.getByRole("button", { name: "GF" })).toBeInTheDocument();
    expect(fake.uploads).toBe(1);

    // the floor still lives on the (now-completed) Plans step
    await user.click(screen.getByRole("button", { name: /Plans/ }));
    expect(await screen.findByDisplayValue("Ground floor")).toBeInTheDocument();
  });

  it("skipping the floor name commits it by stack position, not the page label", async () => {
    pdfToPages.mockResolvedValue([page("Page 6", 6)]);
    const fake = new CountingPlanImages();
    const user = await openPlanJob(fake);

    uploadPdf();
    // leave the name empty (null ⇒ don't type anything)
    await nameFloors(user, [null]);
    // stack the page as the ground floor
    dropPage(yardFirst(), 0);

    // commit → the floor tab reads its POSITION (GF), never "Page 6"
    await user.click(screen.getByRole("button", { name: /Start design/ }));
    expect(await screen.findByTestId("studio-canvas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "GF" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Page 6/ })).toBeNull();

    // and the Plans floor-list names it by position too
    await user.click(screen.getByRole("button", { name: /Plans/ }));
    expect(await screen.findByDisplayValue("Ground floor")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Page 6")).toBeNull();
  });

  it("two-storey house from a 4-page set: unused sheets are kept so the session restores", async () => {
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
    expect(await screen.findByText(/Click the pages you want to upload/)).toBeInTheDocument();
    expect(screen.queryByText("Floors")).toBeNull();

    // pages come in as "Page 1..4"; use only the two floor plans (2 + 3)
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
    // only the two PLACED pages get a rendered image; the site plan/elevations
    // are never rendered to storage — the source PDF (1 file) is, so returning
    // re-rasterises the full grid from it
    expect(fake.uploads).toBe(2);
    expect(fake.sourceUploads).toBe(1);
  });

  it("returning to Plans restores the whole session — files, every page, and the stacker", async () => {
    pdfToPages.mockResolvedValue([page("A", 1), page("B", 2), page("C", 3)]);
    const fake = new CountingPlanImages();
    const user = await openPlanJob(fake);

    uploadPdf();
    // use only page 2; leave pages 1 and 3 unselected
    await user.click(await screen.findByRole("button", { name: "Page 2" }));
    await user.click(screen.getByRole("button", { name: /Continue with 1 page/ }));
    await nameFloors(user, ["Ground floor"]);
    dropPage(yardFirst(), 1);
    await startDesignThenReviewPlans(user);

    // the stacker rebuilt with the committed floor's plan card in place
    expect(floorCard("Ground floor")).toBeInTheDocument();
    // the upload summary lists every page that was uploaded (all 3 stored)
    expect(screen.getByText("3 pages")).toBeInTheDocument();
    // reopen Select pages → the full grid is back, including the unused pages
    await user.click(screen.getByText("Select pages"));
    expect(await screen.findByRole("button", { name: "Page 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Page 3" })).toBeInTheDocument();
    // page 2 is still the one marked selected
    expect(screen.getByRole("button", { name: "Page 2" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    // only the one placed page was rendered to storage; the grid rebuilt by
    // re-rasterising the stored source PDF (1 file)
    expect(fake.uploads).toBe(1);
    expect(fake.sourceUploads).toBe(1);
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
    expect(merged.querySelectorAll(".ds-plancard")).toHaveLength(2);

    await startDesignThenReviewPlans(user);
    expect(screen.getByDisplayValue("Basement")).toBeInTheDocument();
    expect(fake.uploads).toBe(4);
    // floor list: B1 basement, GF, L1 = the merged Level 2 with two sheets
    // (levels also appear on the rebuilt stacker, so scope to the Floors list)
    expect(within(floorsList()).getByText("B1")).toBeInTheDocument();
    expect(within(floorsList()).getByText("GF")).toBeInTheDocument();
    expect(within(floorsList()).getByText("L1")).toBeInTheDocument();
    expect(screen.getByText("2 sheets")).toBeInTheDocument();
  });

  it("a single sheet can be pulled OFF a two-sheet floor onto another floor", async () => {
    pdfToPages.mockResolvedValue([page("A", 1), page("B", 2)]);
    const user = await openPlanJob(new CountingPlanImages());

    uploadPdf();
    await user.click(await screen.findByRole("button", { name: "Page 1" }));
    await user.click(screen.getByRole("button", { name: "Page 2" }));
    await user.click(screen.getByRole("button", { name: /Continue with 2 pages/ }));
    await nameFloors(user, ["East", "West"]);

    // both onto one ground floor → two plan cards on one level
    dropPage(yardFirst(), 0);
    dropPage(floorCard("East"), 1);
    expect(floorCard("East").querySelectorAll(".ds-plancard")).toHaveLength(2);

    // the plan card is the drag source (the level row itself is NOT draggable)
    expect(floorCard("East").getAttribute("draggable")).toBeNull();
    const cards = floorCard("East").querySelectorAll(".ds-plancard");
    expect(cards[1].getAttribute("draggable")).toBe("true");
    // pull that plan (page 1) up into the slot above → its own floor
    dropPage(gapAbove("East"), 1);

    // now two separate floors, one plan each
    expect(floorCard("East").querySelectorAll(".ds-plancard")).toHaveLength(1);
    expect(floorCard("West").querySelectorAll(".ds-plancard")).toHaveLength(1);
    // West sits above East (L1 over GF)
    expect(floorCard("West").querySelector(".ds-floor-lvl")!.textContent).toBe("L1");
  });

  it("a floor moves by dragging its plan card to another slot (no row drag)", async () => {
    pdfToPages.mockResolvedValue([page("A", 1), page("B", 2)]);
    const user = await openPlanJob(new CountingPlanImages());

    uploadPdf();
    await user.click(await screen.findByRole("button", { name: "Page 1" }));
    await user.click(screen.getByRole("button", { name: "Page 2" }));
    await user.click(screen.getByRole("button", { name: /Continue with 2 pages/ }));
    await nameFloors(user, ["Ground", "Upper"]);

    dropPage(yardFirst(), 0); // Ground → GF (anchor)
    dropPage(gapAbove("Ground"), 1); // Upper → L1
    expect(floorCard("Upper").querySelector(".ds-floor-lvl")!.textContent).toBe("L1");

    // drag Upper's plan card (page 1) down onto the bottom slot → below ground
    dropPage(subfloorGap(), 1);
    expect(floorCard("Upper").querySelector(".ds-floor-lvl")!.textContent).toBe("B1");
    // Ground is the anchor, so it carries the level dropdown (still GF)
    expect(screen.getByLabelText("Level for Ground")).toHaveValue("0");
  });

  it("drop targets highlight individually on dragenter and clear on dragleave", async () => {
    pdfToPages.mockResolvedValue([page("Ground", 1), page("Upper", 2)]);
    const user = await openPlanJob(new CountingPlanImages());

    uploadPdf();
    await user.click(await screen.findByRole("button", { name: "Page 1" }));
    await user.click(screen.getByRole("button", { name: "Page 2" }));
    await user.click(screen.getByRole("button", { name: /Continue with 2 pages/ }));
    await nameFloors(user, ["Ground", "Upper"]);

    // the very first drop zone: no highlight until dragenter fires
    const first = yardFirst();
    expect(first.className).not.toContain("over");
    fireEvent.dragEnter(first, dropPayload("p:0"));
    expect(first.className).toContain("over");
    fireEvent.dragLeave(first);
    expect(first.className).not.toContain("over");

    dropPage(first, 0); // Ground → GF

    // a level card highlights only while the cursor is actually over it
    const groundCard = floorCard("Ground");
    expect(groundCard.className).not.toContain("over");
    fireEvent.dragEnter(groundCard, dropPayload("p:1"));
    expect(groundCard.className).toContain("over");
    // the plan card inside has no drag-enter/leave handlers of its own, so
    // crossing onto it still bubbles up to the level's handler — a stray
    // leave from that crossing must not fully clear the highlight
    const childCard = groundCard.querySelector(".ds-plancard")!;
    fireEvent.dragEnter(childCard, dropPayload("p:1")); // bubbles → level handler
    fireEvent.dragLeave(childCard); // bubbles → level handler
    expect(groundCard.className).toContain("over");
    // leaving the card entirely does clear it
    fireEvent.dragLeave(groundCard);
    expect(groundCard.className).not.toContain("over");
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

    // second import: the new page lands in the tray (indices continue from the
    // restored session), and the existing floor shows in the yard as a fixed card
    pdfToPages.mockResolvedValue([page("GF West wing", 1)]);
    uploadPdf();
    // the new page renders into the tray once the upload settles
    await screen.findByText("1 plan to place");
    const existing = floorCard("Ground floor");
    expect(existing.className).toContain("existing");
    dropPage(existing, 1); // merge the west wing (new page, idx 1) onto it

    await startDesignThenReviewPlans(user);
    expect(screen.getByText("2 sheets")).toBeInTheDocument();
    // still exactly one floor
    expect(screen.getAllByDisplayValue("Ground floor")).toHaveLength(1);
    // one rendered image per placed page (2), one source per import (2)
    expect(fake.uploads).toBe(2);
    expect(fake.sourceUploads).toBe(2);
  });

  it("back-navigation never loses typed names (no retyping = no double handling)", async () => {
    pdfToPages.mockResolvedValue([page("Page 1", 1), page("Page 2", 2)]);
    const user = await openPlanJob(new CountingPlanImages());

    uploadPdf();
    await user.click(await screen.findByRole("button", { name: "Page 1" }));
    await user.click(screen.getByRole("button", { name: "Page 2" }));
    await user.click(screen.getByRole("button", { name: /Continue with 2 pages/ }));

    const input = await screen.findByLabelText("Page name");
    await user.clear(input);
    await user.type(input, "Ground floor (verified)");

    // back to the picker, then continue again — the typed name must survive
    await user.click(screen.getByRole("button", { name: "Back to pages" }));
    await user.click(screen.getByRole("button", { name: /Continue with 2 pages/ }));
    expect(await screen.findByLabelText("Page name")).toHaveValue(
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
    // idle again: the upload bar is back (the Floors section stays hidden until
    // there's at least one floor)
    expect(screen.getByText("Drop floor plans here")).toBeInTheDocument();
    expect(screen.queryByText("Floors")).toBeNull();
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

    // the expand button opens the full-size lightbox (stacked over the picker
    // modal, which is itself a dialog) and does NOT toggle
    await user.click(screen.getByRole("button", { name: "Preview Page 3" }));
    const dialog = await screen.findByRole("dialog", { name: /Page preview/ });
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
    // committed with the re-pinned levels (scope to the list — the stacker
    // shows the same levels)
    expect(within(floorsList()).getByText("B2")).toBeInTheDocument();
    expect(within(floorsList()).getByText("B1")).toBeInTheDocument();
    expect(fake.uploads).toBe(2);
  });

  it("picker shows the AI-screening slot (disabled placeholder for now)", async () => {
    pdfToPages.mockResolvedValue([page("a", 1), page("b", 2)]);
    const user = await openPlanJob(new CountingPlanImages());
    uploadPdf();
    await screen.findByText(/Click the pages you want to upload/);
    const ai = screen.getByRole("button", { name: /AI screening/ });
    expect(ai).toBeDisabled();
    expect(user).toBeTruthy();
  });
});
