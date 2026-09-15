/* The start screen shows the five most recent designs, says how many more
   there are, and the search still reaches the rest. */

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
    expect(within(card).getByText("2 more designs")).toBeInTheDocument();
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
