/* THE JOB IN THE STUDIO'S BAR (Isaac, 18 November 2026: "make it one big
   pill like the job cards on other pages, with Open job at its end", then
   "Yes, build it" to the bar and panel mock, 21 November 2026). In the next
   flow a design on a job shows the job as the Jobs list draws it, with Scope
   and Open job inside its end; the design's name moves into the Menu. A
   design on no job keeps its name in the bar. */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Studio } from "../studio";
import { LocalDesignStore } from "@/lib/studio/store";
import { createDesign } from "@/lib/studio/document";

jest.mock("@/app/actions/studio", () => ({
  readStudioJobs: jest.fn(async () => [
    {
      remoteId: "job-9001",
      jobNumber: "9001",
      clientName: "Rivers, Sam",
      status: "Work Order",
      address: "4 Example Street\nSampleton NSW 2000",
      suburb: "Sampleton",
      description: null,
      kind: "Install ",
      hue: "purple",
    },
  ]),
}));

const onJob = () =>
  createDesign({
    name: "4 Example Street, Sampleton",
    mode: "blank",
    jobNumber: "9001",
    client: "Sam Rivers",
    site: "4 Example Street, Sampleton",
    job: { remoteId: "job-9001", jobNumber: "9001" },
  });

describe("the job in the Studio's bar", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/dashboard/studio");
  });

  it("shows a design's job as its card, Scope and Open job inside it", async () => {
    const store = new LocalDesignStore(window.localStorage);
    const doc = onJob();
    await store.save(doc);
    render(<Studio store={store} openDesignId={doc.id} flow="next" />);

    const card = (await screen.findByText("Rivers, Sam")).closest(".ds-jobcard") as HTMLElement;
    expect(card).not.toBeNull();
    expect(within(card).getByText("9001").closest(".jl-card")).toHaveClass("jl-card--purple");
    // the kind as ServiceM8 has it, trimmed, then the suburb
    expect(within(card).getByText("Install, Sampleton")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Scope" })).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Open job" })).toBeInTheDocument();
    // the name is not in the bar any more
    expect(screen.queryByRole("textbox", { name: "Design name" })).toBeNull();
  });

  it("keeps the design's name in the Menu", async () => {
    const user = userEvent.setup();
    const store = new LocalDesignStore(window.localStorage);
    const doc = onJob();
    await store.save(doc);
    render(<Studio store={store} openDesignId={doc.id} flow="next" />);

    await screen.findByText("Rivers, Sam");
    await user.click(screen.getByRole("button", { name: "Studio menu" }));
    const name = screen.getByRole("textbox", { name: "Design name" });
    expect(name).toHaveValue("4 Example Street, Sampleton");
    await user.clear(name);
    await user.type(name, "Option B");
    expect(screen.getByRole("textbox", { name: "Design name" })).toHaveValue("Option B");
  });

  it("leaves a design on no job with its name in the bar", async () => {
    const store = new LocalDesignStore(window.localStorage);
    const doc = createDesign({ name: "10 Test Road", mode: "blank" });
    await store.save(doc);
    render(<Studio store={store} openDesignId={doc.id} flow="next" />);

    expect(await screen.findByLabelText("Design name")).toHaveValue("10 Test Road");
    expect(document.querySelector(".ds-jobcard")).toBeNull();
  });
});
