/* THE STUDIO'S BAR, AS AN IPAD'S (Isaac, 22 November 2026: "imagine top bar
   was ipad", then "actions can be menu. suburb not needed, tapping a down
   arrow next to name shows job info and say open job in new tab scop better
   button", and "Yes, build it" to
   https://claude.ai/artifact/LRDHmN2N8ntSRqryrSyMUd). In the next flow a
   design on a job shows the job on the left, its number in its colour and
   the client, with a down arrow that shows the job; Design, Schematic and
   Summary in the middle; Scope and Menu on the right; and the plan's own
   view on the plan. A design on no job keeps its name in the bar. */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Studio } from "../studio";
import { LocalDesignStore } from "@/lib/studio/store";
import { createDesign, type DesignDocument } from "@/lib/studio/document";

jest.mock("@/app/actions/studio", () => ({
  readStudioJobs: jest.fn(async () => [
    {
      remoteId: "job-9001",
      jobNumber: "9001",
      clientName: "Rivers, Sam",
      status: "Work Order",
      // one line, its suburb, state and postcode after commas
      address: "4 Example Street, Sampleton, NSW 2000",
      suburb: "Sampleton",
      description: null,
      kind: "Install ",
      hue: "purple",
    },
  ]),
}));

const onJob = (): DesignDocument =>
  createDesign({
    name: "4 Example Street, Sampleton",
    mode: "blank",
    jobNumber: "9001",
    client: "Sam Rivers",
    site: "4 Example Street, Sampleton",
    job: { remoteId: "job-9001", jobNumber: "9001" },
  });

/* a floor to draw on, so the Design step has a plan */
const withFloor = (doc: DesignDocument): DesignDocument => ({
  ...doc,
  floors: [{ id: "gf", name: "Ground floor", level: 0, scaleMmPerUnit: 10, northDeg: null, northPos: null, plans: [] }],
});

async function open(doc: DesignDocument) {
  const store = new LocalDesignStore(window.localStorage);
  await store.save(doc);
  render(<Studio store={store} openDesignId={doc.id} flow="next" />);
}

describe("the Studio's bar, as an iPad's", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/dashboard/studio");
  });

  it("shows the job on the left, the tabs in the middle, Scope and Menu on the right", async () => {
    await open(onJob());
    const job = (await screen.findByText("Rivers, Sam")).closest("button") as HTMLElement;
    expect(job).toHaveClass("ds-jobtitle-btn", "jp-plate--purple");
    expect(within(job).getByText("9001")).toHaveClass("jp-num");
    // no suburb in the bar
    expect(screen.queryByText("Install, Sampleton")).toBeNull();
    expect(document.querySelector(".ds-topbar .ds-centre .ds-steps")).not.toBeNull();
    const right = document.querySelector(".ds-topbar .ds-tb-right") as HTMLElement;
    expect(within(right).getByRole("button", { name: "Scope" })).toHaveClass("pt-btn--second");
    expect(within(right).getByRole("button", { name: "Studio menu" })).toBeInTheDocument();
    // the design's name is in the Menu, not the bar
    expect(screen.queryByRole("textbox", { name: "Design name" })).toBeNull();
    // Tiff's zones are the column's Zones, not a chip in the bar
    expect(screen.queryByText("Zones Tiff found")).toBeNull();
  });

  it("shows the job from the arrow by its name: where it is, its Status and Category, and Open job in new tab", async () => {
    const user = userEvent.setup();
    await open(onJob());
    const job = (await screen.findByText("Rivers, Sam")).closest("button") as HTMLElement;
    expect(job).toHaveAttribute("aria-expanded", "false");
    await user.click(job);
    const card = screen.getByRole("dialog", { name: "Job 9001" });
    expect(within(card).getByText("4 Example Street").tagName).toBe("B");
    expect(card).toHaveTextContent("4 Example Street, Sampleton, NSW 2000");
    expect(within(card).getByText("Work Order")).toBeInTheDocument();
    // the kind as ServiceM8 has it, trimmed
    expect(within(card).getByText("Install")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Open job in new tab" })).toHaveAttribute("href", "/dashboard/jobs/job-9001");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Job 9001" })).toBeNull();
  });

  it("keeps the design's name in the Menu, without New or Open", async () => {
    const user = userEvent.setup();
    await open(onJob());
    await screen.findByText("Rivers, Sam");
    await user.click(screen.getByRole("button", { name: "Studio menu" }));
    const name = screen.getByRole("textbox", { name: "Design name" });
    expect(name).toHaveValue("4 Example Street, Sampleton");
    await user.clear(name);
    await user.type(name, "Option B");
    expect(screen.getByRole("textbox", { name: "Design name" })).toHaveValue("Option B");
    expect(screen.queryByRole("menuitem", { name: "New" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Open" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Edit plans" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete design" })).toHaveClass("ds-menu-item--danger");
  });

  it("puts Plan or 3D, the floor and View on the plan, not in the bar", async () => {
    await open(withFloor(onJob()));
    await screen.findByText("Rivers, Sam");
    const top = document.querySelector(".ds-canvas-col .ds-plan-top") as HTMLElement;
    expect(top).not.toBeNull();
    expect(within(top).getByRole("button", { name: "Plan" })).toBeInTheDocument();
    expect(within(top).getByRole("button", { name: "3D" })).toBeInTheDocument();
    expect(document.querySelector(".ds-topbar .ds-viewtray")).toBeNull();
  });

  it("leaves a design on no job with its name in the bar and no Scope", async () => {
    await open(createDesign({ name: "10 Test Road", mode: "blank" }));
    expect(await screen.findByLabelText("Design name")).toHaveValue("10 Test Road");
    expect(document.querySelector(".ds-jobtitle")).toBeNull();
    expect(screen.queryByRole("button", { name: "Scope" })).toBeNull();
    expect(screen.getByRole("button", { name: "Studio menu" })).toBeInTheDocument();
  });
});
