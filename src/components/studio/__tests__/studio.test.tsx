/* Stage-0 UI verification: the studio mounts as a real React tree, the
   new-design flow creates + autosaves a document, the Design/Summary tabs and
   the studio menu switch stage panels, and a remount recovers the design from
   persistence. */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

/* the top-left studio menu: open it, then pick an item */
async function menuPick(
  user: ReturnType<typeof userEvent.setup>,
  item: string
) {
  await user.click(screen.getByRole("button", { name: "Studio menu" }));
  await user.click(screen.getByRole("menuitem", { name: item }));
}

describe("Design Studio shell", () => {
  beforeEach(() => window.localStorage.clear());

  it("renders the home hero, and settles on an empty recents list", async () => {
    render(localStudio());
    expect(await screen.findByText("New design")).toBeInTheDocument();
    expect(screen.getByText("Recent designs")).toBeInTheDocument();
    /* AFTER the list answers. This assertion used to run immediately and pass,
       which is the bug it now guards: "No designs yet" was the empty state AND
       the loading state, so the home screen told somebody with three designs
       that they had none for as long as the server took. */
    expect(await screen.findByText("No designs yet")).toBeInTheDocument();
  });

  it("HOLDS THE SPACE while the list is still being fetched", async () => {
    /* a store that never answers — the loading state on its own */
    const pending = {
      list: () => new Promise<never>(() => {}),
      load: async () => null,
      save: async () => {},
      remove: async () => {},
    };
    render(<Studio store={pending} />);
    expect(await screen.findByText("New design")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading your designs");
    /* and it must NOT claim the answer it does not have */
    expect(screen.queryByText("No designs yet")).not.toBeInTheDocument();
  });

  it("PAINTS WHAT THIS MACHINE KNOWS before the server answers", async () => {
    /* the reason the loading state was on screen for over three seconds in
       production: the merged list waits on the network, and the local index is
       a localStorage read that was being held behind it */
    const local = new LocalDesignStore(window.localStorage);
    const doc = {
      ...JSON.parse(
        JSON.stringify({
          schemaVersion: 9, id: "dsn_local", meta: { name: "Kembla Street", jobNumber: "", client: "", site: "", mode: "blank", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", variantLabel: null },
          settings: { climateZone: null, buildingType: null, sizingBasis: "worst-of-both", units: "mm" },
          floors: [], objects: [], systems: [], packPins: {}, variants: [], planImport: null, jobLink: null, simApprovals: [],
        })
      ),
    };
    await local.save(doc);

    const slow = {
      /* the server, still thinking */
      list: () => new Promise<never>(() => {}),
      listLocal: () => local.list(),
      load: (id: string) => local.load(id),
      save: async () => {},
      remove: async () => {},
    };
    render(<Studio store={slow} />);
    expect(await screen.findByText("Kembla Street")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
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

    // blank canvas lands STRAIGHT on the canvas — no Plans detour.
    // findBy*: the swap runs behind the frosted-glass veil, so it isn't sync.
    expect(await screen.findByLabelText("Design name")).toHaveValue(
      "12 Test Street"
    );
    expect(screen.getByRole("navigation", { name: "Workflow" })).toBeInTheDocument();
    expect(screen.getByTestId("studio-canvas")).toBeInTheDocument();
    // the Plans screen (menu → Edit plans) still holds the default floor
    await menuPick(user, "Edit plans");
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

    // tab click-to-jump renders each stage; Summary is Materials+Job merged.
    // Scope to the tab nav — the Plans floor rows also offer a "Design" button.
    await user.click(
      within(screen.getByRole("navigation", { name: "Workflow" })).getByRole(
        "button",
        { name: "Design" }
      )
    );
    expect(screen.getByTestId("studio-canvas")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Summary" }));
    /* the row of six: three measurements, then the three assumptions every
       one of them rests on — the same document the customer's link renders */
    expect(screen.getByText("Calculated heat load")).toBeInTheDocument();
    expect(screen.getByText("Climate zone")).toBeInTheDocument();
    expect(screen.getByText(/^Zone \d/)).toBeInTheDocument();
    expect(
      screen.getByText("An empty design is an empty sheet")
    ).toBeInTheDocument();
  });

  /* The Calibrate menu is plan-prep's one home. Crop and Move act on the plan
     SHEETS — a blank grid has none, so both grey out with the reason worn in
     place, and their X/M keys stay inert exactly like the rows. The tape is
     the contrast: blank grids are pre-scaled, so K works from the start. */
  it("Calibrate greys the sheet tools on a blank grid and keeps their keys inert", async () => {
    const user = userEvent.setup();
    render(localStudio());
    await newDesign(user, "Blank gating", "Blank canvas");
    await screen.findByTestId("studio-canvas");

    const pill = screen.getByTitle("Calibrate — set the scale and north");
    await user.click(pill);
    const crop = screen.getByRole("button", { name: /Crop/ });
    const move = screen.getByRole("button", { name: /Move plans/ });
    expect(crop).toBeDisabled();
    expect(move).toBeDisabled();
    // the reason sits in the row, not only in a tooltip
    expect(crop.textContent).toContain("No plan");
    expect(move.textContent).toContain("No plan");
    // the tape is available — a blank grid is born scaled — and its shortcut
    // reads as an offer (kbd chip), not the amber unset warning
    const tape = screen.getByRole("button", { name: /Tape measure/ });
    expect(tape).toBeEnabled();
    expect(tape.querySelector(".v.kbd")!.textContent).toBe("K");

    await user.click(pill); // fold the menu so the pill's lit state is the tool's

    // X and M do nothing here; K arms the tape (the positive control that
    // proves the key path itself is alive in this harness)
    fireEvent.keyDown(window, { key: "x" });
    expect(pill.className).not.toMatch(/\bon\b/);
    fireEvent.keyDown(window, { key: "m" });
    expect(pill.className).not.toMatch(/\bon\b/);
    fireEvent.keyDown(window, { key: "k" });
    expect(pill.className).toMatch(/\bon\b/);
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
    // findBy*: reopening runs behind the veil, so the editor isn't sync
    expect(await screen.findByLabelText("Design name")).toHaveValue(
      "Recovery job"
    );
    // blank designs reopen on the canvas; the floor is on the Plans screen
    await menuPick(user, "Edit plans");
    expect(screen.getByDisplayValue("Ground floor")).toBeInTheDocument();
  });

  it("menu Open exits to a plain Home; menu New arrives mid-wizard", async () => {
    const user = userEvent.setup();
    render(localStudio());
    await newDesign(user, "Menu flows", "Blank canvas");
    expect(await screen.findByLabelText("Design name")).toHaveValue(
      "Menu flows"
    );

    // Open → the home/recents screen, hero CTA idle
    await menuPick(user, "Open");
    expect(await screen.findByText("New design")).toBeInTheDocument();
    expect(screen.queryByText("Step 1 of 2")).toBeNull();

    // back into the design, then New → home with the wizard already open
    await user.click(
      (await screen.findByText("Menu flows")).closest(".ds-rcard") as HTMLElement
    );
    expect(await screen.findByLabelText("Design name")).toHaveValue(
      "Menu flows"
    );
    await menuPick(user, "New");
    expect(await screen.findByText("Step 1 of 2")).toBeInTheDocument();
  });

  it("Summary's Export downloads the design file (it left the menu)", async () => {
    const user = userEvent.setup();
    render(localStudio());
    await newDesign(user, "Export me", "Blank canvas");
    expect(await screen.findByLabelText("Design name")).toHaveValue(
      "Export me"
    );

    // no longer a menu item
    await user.click(screen.getByRole("button", { name: "Studio menu" }));
    expect(screen.queryByRole("menuitem", { name: "Export" })).toBeNull();
    await user.keyboard("{Escape}");

    // jsdom has no createObjectURL — stub the download seam
    const createURL = jest.fn(() => "blob:mock");
    const revokeURL = jest.fn();
    Object.defineProperty(URL, "createObjectURL", {
      value: createURL,
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: revokeURL,
      configurable: true,
    });
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    await user.click(
      within(screen.getByRole("navigation", { name: "Workflow" })).getByRole(
        "button",
        { name: "Summary" }
      )
    );
    /* Export asks WHAT you are sending, then does it: pick the design file,
       then press the button that says it will download one */
    await user.click(await screen.findByRole("button", { name: /^Export/ }));
    await user.click(
      await screen.findByRole("radio", { name: "The design file" })
    );
    await user.click(
      screen.getByRole("button", { name: "Download the design file" })
    );
    expect(createURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeURL).toHaveBeenCalledWith("blob:mock");
    click.mockRestore();
  });
});

/* Fullscreen — the Workboard's display mode, ported. The topbar toggle takes
   the app frame away and leaves the editor exactly where it was. jsdom has no
   Fullscreen API, which is fine and deliberate: a missing API still hides the
   shell, and the attribute on <html> is the honest assertion (the CSS keys
   off it because the fullscreen element is the DOCUMENT — every studio
   overlay portals to <body>). */
describe("fullscreen", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => document.documentElement.removeAttribute("data-ds-display"));

  const enterEditor = async (user: ReturnType<typeof userEvent.setup>) => {
    await newDesign(user, "Big screen", "Blank canvas");
    expect(await screen.findByLabelText("Design name")).toBeInTheDocument();
  };

  it("marks the root on the way in and un-marks it on the way out", async () => {
    const user = userEvent.setup();
    render(localStudio());
    await enterEditor(user);
    await user.click(screen.getByRole("button", { name: "Fullscreen" }));
    expect(document.documentElement).toHaveAttribute("data-ds-display", "on");
    await user.click(screen.getByRole("button", { name: "Exit fullscreen" }));
    expect(document.documentElement).not.toHaveAttribute("data-ds-display");
  });

  it("leaves the mode when the browser leaves fullscreen (Esc)", async () => {
    const user = userEvent.setup();
    render(localStudio());
    await enterEditor(user);
    await user.click(screen.getByRole("button", { name: "Fullscreen" }));
    // entry must have landed, or the exit assertions below prove nothing
    expect(document.documentElement).toHaveAttribute("data-ds-display", "on");
    act(() => void document.dispatchEvent(new Event("fullscreenchange")));
    expect(document.documentElement).not.toHaveAttribute("data-ds-display");
    expect(
      screen.getByRole("button", { name: "Fullscreen" })
    ).toBeInTheDocument();
  });

  it("leaving the editor takes the mode with it — Home never sits chromeless", async () => {
    const user = userEvent.setup();
    render(localStudio());
    await enterEditor(user);
    await user.click(screen.getByRole("button", { name: "Fullscreen" }));
    expect(document.documentElement).toHaveAttribute("data-ds-display", "on");
    await menuPick(user, "Open");
    expect(await screen.findByText("New design")).toBeInTheDocument();
    expect(document.documentElement).not.toHaveAttribute("data-ds-display");
  });
});
