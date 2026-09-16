/* The start screen shows the five most recent designs, opens the rest in
   place from the button under them, and the search still reaches the rest. */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Studio } from "../studio";
import { LocalDesignStore } from "@/lib/studio/store";
import { createDesign } from "@/lib/studio/document";

describe("recent designs are capped at five", () => {
  beforeEach(() => window.localStorage.clear());

  async function seed(n: number) {
    const local = new LocalDesignStore(window.localStorage);
    for (let i = 1; i <= n; i++) {
      const d = createDesign({ name: `Design ${i}`, mode: "blank" });
      /* newest last, so "Design n" is the most recent */
      d.meta.updatedAt = new Date(Date.UTC(2026, 0, i)).toISOString();
      await local.save(d);
    }
    return local;
  }

  it("shows the five newest and counts the rest", async () => {
    const local = await seed(7);
    render(<Studio store={local} />);
    const list = await screen.findByText("Recent designs");
    const card = list.closest(".ds-recent") as HTMLElement;
    const names = await within(card).findAllByText(/^Design \d+$/);
    expect(names.map((n) => n.textContent)).toEqual(["Design 7", "Design 6", "Design 5", "Design 4", "Design 3"]);
    expect(within(card).getByRole("button", { name: "Show 2 more designs" })).toBeInTheDocument();
  });

  /* it was a line of text that counted them, and pressing it did nothing */
  it("the count under the five is a button that opens the rest, and closes them", async () => {
    const user = userEvent.setup();
    const local = await seed(7);
    render(<Studio store={local} />);
    const card = (await screen.findByText("Recent designs")).closest(".ds-recent") as HTMLElement;
    expect(await within(card).findAllByText(/^Design \d+$/)).toHaveLength(5);

    const more = within(card).getByRole("button", { name: "Show 2 more designs" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await user.click(more);
    expect(within(card).getAllByText(/^Design \d+$/).map((n) => n.textContent)).toEqual([
      "Design 7", "Design 6", "Design 5", "Design 4", "Design 3", "Design 2", "Design 1",
    ]);

    const fewer = within(card).getByRole("button", { name: "Show fewer designs" });
    expect(fewer).toHaveAttribute("aria-expanded", "true");
    await user.click(fewer);
    expect(within(card).getAllByText(/^Design \d+$/)).toHaveLength(5);
    expect(within(card).getByRole("button", { name: "Show 2 more designs" })).toBeInTheDocument();
  });

  it("one beyond the five is one design", async () => {
    const local = await seed(6);
    render(<Studio store={local} />);
    const card = (await screen.findByText("Recent designs")).closest(".ds-recent") as HTMLElement;
    await within(card).findAllByText(/^Design \d+$/);
    expect(within(card).getByRole("button", { name: "Show 1 more design" })).toBeInTheDocument();
  });

  it("says nothing extra when there are five or fewer", async () => {
    const local = await seed(5);
    render(<Studio store={local} />);
    const card = (await screen.findByText("Recent designs")).closest(".ds-recent") as HTMLElement;
    expect(await within(card).findAllByText(/^Design \d+$/)).toHaveLength(5);
    expect(within(card).queryByText(/more design/)).not.toBeInTheDocument();
  });

  it("search reaches a design beyond the five", async () => {
    const user = userEvent.setup();
    const local = await seed(7);
    render(<Studio store={local} />);
    const card = (await screen.findByText("Recent designs")).closest(".ds-recent") as HTMLElement;
    await within(card).findAllByText(/^Design \d+$/);
    await user.type(within(card).getByPlaceholderText(/Search designs/), "Design 1");
    expect(within(card).getByText("Design 1")).toBeInTheDocument();
    expect(within(card).queryByText("Design 7")).not.toBeInTheDocument();
    expect(within(card).queryByText(/more design/)).not.toBeInTheDocument();
  });
});
