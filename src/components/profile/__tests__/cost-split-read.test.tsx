import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PayrollCard } from "../payroll-card";
import type { PayFields } from "../types";

/* The cost split has to be READABLE without entering edit mode.

   It stopped being, and the way it broke is worth pinning. Three rules hid the
   sliders and collapsed their track — all scoped to `.card2.readonly`, a class
   the Payroll section stopped rendering when the tab became its title. Nothing
   errored: the rules simply stopped matching, `.cspct` kept the 170px the
   slider occupies, and the percentage sat alone at the end of an empty trough.
   Which is precisely what a control that failed to render looks like — "the
   cost split seemed to be hidden until I clicked set" (Isaac, live).

   A CSS-only regression, invisible to every test in the suite, is what these
   assert against: the READ view owns a filled track of its own, in the DOM,
   rather than borrowing the edit view's and hiding half of it. */

const onSave = jest.fn(async () => ({ ok: true as const }));

const pay = (over: Partial<PayFields> = {}): PayFields =>
  ({ hourly_wage: 45, cost_split: { install: 55, service: 35, admin: 10 }, ...over }) as PayFields;

const fills = (c: HTMLElement) =>
  [...c.querySelectorAll<HTMLElement>(".csfill")].map((f) => f.style.width);

describe("reading the split", () => {
  it("draws each share as a filled track, not a bare number", () => {
    const { container } = render(<PayrollCard pay={pay()} onSave={onSave} />);

    expect(fills(container)).toEqual(["55%", "35%", "10%"]);
    // and the numbers still agree with the bars
    for (const n of ["55%", "35%", "10%"]) {
      expect(screen.getByText(n)).toBeInTheDocument();
    }
  });

  /* The bars sit beside the donut. Two pictures of one number that disagreed
     about the colours would be worse than one picture. */
  it("colours each bar as its own row's dot", () => {
    const { container } = render(<PayrollCard pay={pay()} onSave={onSave} />);
    const dots = [...container.querySelectorAll<HTMLElement>(".csdot")].map((d) => d.style.background);
    const bars = [...container.querySelectorAll<HTMLElement>(".csfill")].map((f) => f.style.background);
    expect(bars).toEqual(dots);
    expect(bars).toHaveLength(3);
  });

  it("falls back to even thirds rather than three empty tracks", () => {
    const { container } = render(<PayrollCard pay={pay({ cost_split: null })} onSave={onSave} />);
    expect(fills(container)).toEqual(["34%", "33%", "33%"]);
  });

  /* The read view must not be borrowing the edit view's control with its thumb
     hidden — that is the shape the regression had. */
  it("offers nothing draggable until you ask to edit", async () => {
    const user = userEvent.setup();
    const { container } = render(<PayrollCard pay={pay()} onSave={onSave} />);
    expect(container.querySelectorAll(".csrange")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: /^Edit$/ }));
    expect(container.querySelectorAll(".csrange")).toHaveLength(3);
  });
});
