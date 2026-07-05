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

describe("Design Studio shell", () => {
  beforeEach(() => window.localStorage.clear());

  it("renders the home hero with an empty recents list", async () => {
    render(localStudio());
    expect(await screen.findByText("New design")).toBeInTheDocument();
    expect(screen.getByText("Recent designs")).toBeInTheDocument();
    expect(screen.getByText("No designs yet")).toBeInTheDocument();
  });

  it("creates a blank-canvas design, autosaves it, and steps through stages", async () => {
    const user = userEvent.setup();
    render(localStudio());

    await user.click(await screen.findByText("New design"));
    await user.type(
      screen.getByPlaceholderText(/Design name/),
      "12 Test Street"
    );
    await user.click(screen.getByText("Blank canvas"));

    // editor chrome: stepper + named design + Plans panel with default floor
    expect(screen.getByLabelText("Design name")).toHaveValue("12 Test Street");
    expect(screen.getByRole("navigation", { name: "Workflow" })).toBeInTheDocument();
    expect(screen.getByText("Ground floor")).toBeInTheDocument();

    // autosave lands in localStorage (debounced)
    await waitFor(
      () => {
        const index = JSON.parse(window.localStorage.getItem(INDEX_KEY) ?? "[]");
        expect(index).toHaveLength(1);
        expect(index[0].name).toBe("12 Test Street");
      },
      { timeout: 3000 }
    );

    // stepper click-to-jump renders each stage's empty state
    await user.click(screen.getByRole("button", { name: /Design/ }));
    expect(screen.getByText("Your canvas is waiting")).toBeInTheDocument();
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
    await user.click(await screen.findByText("New design"));
    await user.click(screen.getByText("Blank canvas"));
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
    const card = await screen.findByText("Untitled design");
    await user.click(card.closest(".ds-rcard") as HTMLElement);
    expect(screen.getByLabelText("Design name")).toHaveValue("Untitled design");
    expect(screen.getByText("Ground floor")).toBeInTheDocument();
  });
});
