/* Installer scenario pass — the upload → floors journey end-to-end, driven
   through the real panel UI. Only the pdf.js raster step is mocked (jsdom
   can't run it); everything downstream — picking, naming, stacking,
   uploading, committing floors — is the production code path. */

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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
    // straight into naming — no "Click the pages you want" step
    expect(await screen.findByLabelText("Floor name")).toHaveValue("Floor plan");
    expect(screen.queryByText("Click the pages you want as floors")).toBeNull();

    await nameFloors(user, ["Ground floor"]);
    // stack: one row, chipped GF, name locked from the naming step
    expect(screen.getByText("GF")).toBeInTheDocument();
    expect(screen.getByText("Ground floor")).toBeInTheDocument();
    const stack = document.querySelector(".ds-stack") as HTMLElement;
    expect(within(stack).queryByRole("textbox")).toBeNull(); // stack never renames

    await user.click(screen.getByRole("button", { name: "Add to design" }));
    await waitFor(() => expect(screen.getByDisplayValue("Ground floor")).toBeInTheDocument());
    expect(fake.uploads).toBe(1);
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
    expect(await screen.findByText("Click the pages you want as floors")).toBeInTheDocument();
    expect(screen.queryByText("Floors")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Ground floor" }));
    await user.click(screen.getByRole("button", { name: "Level 1" }));
    await user.click(screen.getByRole("button", { name: /Continue with 2 pages/ }));
    await nameFloors(user, [null, null]); // guessed names are already right

    await user.click(screen.getByRole("button", { name: "Add to design" }));
    await waitFor(() => expect(screen.getByDisplayValue("Level 1")).toBeInTheDocument());
    // only the two chosen pages were uploaded — site plan/elevations never left the browser
    expect(fake.uploads).toBe(2);
    expect(screen.getByText("GF")).toBeInTheDocument();
    expect(screen.getByText("L1")).toBeInTheDocument();
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
    for (const name of ["Basement", "Ground floor", "Level 2 East", "Level 2 West"]) {
      await user.click(await screen.findByRole("button", { name }));
    }
    await user.click(screen.getByRole("button", { name: /Continue with 4 pages/ }));
    // rename both split sheets to the same floor name during verification
    await nameFloors(user, [null, null, "Level 2", "Level 2"]);

    // merge: drop the West page card onto the East row (2nd "Level 2" row in display)
    const eastRow = screen
      .getAllByText("Level 2")[1]
      .closest(".ds-stack-row") as HTMLElement;
    fireEvent.drop(eastRow, dropPayload("p:3"));
    expect(screen.getAllByText("Level 2")).toHaveLength(1);
    const merged = screen.getByText("Level 2").closest(".ds-stack-row") as HTMLElement;
    expect(within(merged).getByText("p.3")).toBeInTheDocument();
    expect(within(merged).getByText("p.4")).toBeInTheDocument();

    // subfloor: drop the Basement row onto the ground line
    fireEvent.drop(
      document.querySelector(".ds-groundline")!,
      dropPayload("r:new_0")
    );
    expect(screen.getByText("B1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add to design" }));
    await waitFor(() => expect(screen.getByDisplayValue("Basement")).toBeInTheDocument());
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
    await user.click(screen.getByRole("button", { name: "Add to design" }));
    await waitFor(() => expect(screen.getByDisplayValue("Ground floor")).toBeInTheDocument());

    // second import: the existing floor shows as a fixed drop target
    pdfToPages.mockResolvedValue([page("GF West wing", 1)]);
    uploadPdf();
    await nameFloors(user, [null]);
    const existingRow = screen
      .getByText("Ground floor")
      .closest(".ds-stack-row") as HTMLElement;
    expect(existingRow.className).toContain("existing");
    fireEvent.drop(existingRow, dropPayload("p:0"));

    await user.click(screen.getByRole("button", { name: "Add to design" }));
    await waitFor(() => expect(screen.getByText("2 sheets")).toBeInTheDocument());
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
});
