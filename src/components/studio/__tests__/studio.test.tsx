/* Stage-0 UI verification: the studio mounts as a real React tree, the
   new-design flow creates + autosaves a document, the stepper switches stage
   panels, and a remount recovers the design from persistence. */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Studio } from "../studio";
import { LocalDesignStore } from "@/lib/studio/store";

const INDEX_KEY = "heytiff.studio.index";

/* Tests inject a local-only store: the default SyncedDesignStore would try
   the studio Server Functions, which don't exist under jsdom. */
const localStudio = () => (
  <Studio store={new LocalDesignStore(window.localStorage)} />
);

/* new-design wizard: name first (step 1), then pick a mode (step 2) */
async function newDesign(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  mode: "Blank canvas" | "Upload floor plans"
) {
  await user.click(await screen.findByText("New design"));
  await user.type(screen.getByPlaceholderText(/Design name/), name);
  await user.click(screen.getByRole("button", { name: /Continue/ }));
  await user.click(screen.getByText(mode));
}

describe("Design Studio shell", () => {
  beforeEach(() => window.localStorage.clear());

  it("renders the home hero with an empty recents list", async () => {
    render(localStudio());
    expect(await screen.findByText("New design")).toBeInTheDocument();
    expect(screen.getByText("Recent designs")).toBeInTheDocument();
    expect(screen.getByText("No designs yet")).toBeInTheDocument();
  });

  it("the new-design wizard names first, then reveals the mode choice", async () => {
    const user = userEvent.setup();
    render(localStudio());

    await user.click(await screen.findByText("New design"));
    // step 1: naming — mode cards are NOT shown yet, Continue is gated on a name
    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
    expect(screen.queryByText("Blank canvas")).toBeNull();
    expect(screen.getByRole("button", { name: /Continue/ })).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/Design name/), "Farran St");
    expect(screen.getByRole("button", { name: /Continue/ })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /Continue/ }));

    // step 2: the mode choice, with the name carried through
    expect(screen.getByText("Step 2 of 2")).toBeInTheDocument();
    expect(screen.getByText("Blank canvas")).toBeInTheDocument();
    expect(screen.getByText("Farran St")).toBeInTheDocument();
    // back returns to naming with the name intact
    await user.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByPlaceholderText(/Design name/)).toHaveValue("Farran St");
  });

  it("creates a blank-canvas design, autosaves it, and steps through stages", async () => {
    const user = userEvent.setup();
    render(localStudio());

    await newDesign(user, "12 Test Street", "Blank canvas");

    // editor chrome: stepper + named design + Plans panel with default floor
    expect(screen.getByLabelText("Design name")).toHaveValue("12 Test Street");
    expect(screen.getByRole("navigation", { name: "Workflow" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Ground floor")).toBeInTheDocument();

    // autosave lands in localStorage (debounced)
    await waitFor(
      () => {
        const index = JSON.parse(window.localStorage.getItem(INDEX_KEY) ?? "[]");
        expect(index).toHaveLength(1);
        expect(index[0].name).toBe("12 Test Street");
      },
      { timeout: 3000 }
    );

    // stepper click-to-jump renders each stage
    await user.click(screen.getByRole("button", { name: "2 Design" }));
    expect(screen.getByTestId("studio-canvas")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Materials/ }));
    expect(
      screen.getByText("An empty design is an empty schedule")
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Job/ }));
    expect(screen.getByText("The job pack comes last")).toBeInTheDocument();
  });

  it("recovers saved designs on a fresh mount (reload survival)", async () => {
    const user = userEvent.setup();
    const first = render(localStudio());
    await newDesign(user, "Recovery job", "Blank canvas");
    await waitFor(
      () =>
        expect(
          JSON.parse(window.localStorage.getItem(INDEX_KEY) ?? "[]")
        ).toHaveLength(1),
      { timeout: 3000 }
    );
    first.unmount();

    // fresh mount = page reload; the design must be in recents and reopenable
    render(localStudio());
    const card = await screen.findByText("Recovery job");
    await user.click(card.closest(".ds-rcard") as HTMLElement);
    expect(screen.getByLabelText("Design name")).toHaveValue("Recovery job");
    expect(screen.getByDisplayValue("Ground floor")).toBeInTheDocument();
  });
});
