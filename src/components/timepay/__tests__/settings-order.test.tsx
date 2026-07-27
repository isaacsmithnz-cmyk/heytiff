import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimePaySettings } from "../settings";
import { DEFAULT_SETTINGS } from "../logic";
import type { PayPeriod } from "../timepay";

/* What you land on when you open the gear.

   Public holidays and Xero payroll used to render OPEN and FIRST, above every
   pay control, so a workspace opening "Pay settings" to change its break
   scrolled a year of dated calendar rows to reach one. Both are now folded and
   last. That ordering is the fix, so it is pinned here rather than left to a
   reviewer's eye — and so is the closed-on-arrival part, because each of those
   sections FETCHES when it mounts. */

const PERIOD: PayPeriod = {
  start: "2026-06-29",
  range: "29 Jun – 5 Jul",
  year: "2026",
  live: true,
  note: "",
};

const HOLIDAYS = <p>the holiday calendar</p>;
const XERO = <p>the payroll roster</p>;

function open(over: { canPay?: boolean; holidays?: boolean; xero?: boolean } = {}) {
  return render(
    <TimePaySettings
      settings={DEFAULT_SETTINGS}
      firstRun={false}
      period={PERIOD}
      canPay={over.canPay ?? true}
      holidaySection={over.holidays === false ? null : HOLIDAYS}
      xeroSection={over.xero === false ? null : XERO}
      onClose={jest.fn()}
      onSave={jest.fn()}
    />
  );
}

/* "Public holidays" is TWO things in this menu — the folding manager and the
   weekend-rate rule for holiday pay — so both helpers below are scoped by
   class rather than by name. That collision is the reason, not an accident of
   the fixture. */

/** The folding row whose label is `label`, or null when it isn't offered. */
function fold(label: string): HTMLButtonElement | null {
  return (
    [...document.querySelectorAll<HTMLButtonElement>(".ms-foldh")].find((b) =>
      b.querySelector(".ms-foldl")?.textContent?.startsWith(label)
    ) ?? null
  );
}

/** Where a section sits in the menu, top to bottom. */
function orderOf(label: string): number {
  const blocks = [...document.querySelectorAll(".wz-menu > .ms")];
  return blocks.findIndex((el) =>
    (el.querySelector(".ms-l") ?? el.querySelector(".ms-foldl"))?.textContent?.startsWith(label)
  );
}

it("pay settings come before the two folding sections", () => {
  open();
  expect(orderOf("Pay cycle")).toBeGreaterThan(-1);
  expect(orderOf("Pay cycle")).toBeLessThan(orderOf("Public holidays"));
  expect(orderOf("Export pay run")).toBeLessThan(orderOf("Public holidays"));
  expect(orderOf("Public holidays")).toBeLessThan(orderOf("Xero payroll"));
});

it("both fold shut on arrival, so neither fetches until it is asked for", () => {
  open();
  expect(screen.queryByText("the holiday calendar")).not.toBeInTheDocument();
  expect(screen.queryByText("the payroll roster")).not.toBeInTheDocument();
  expect(fold("Public holidays")).toHaveAttribute("aria-expanded", "false");
  expect(fold("Xero payroll")).toHaveAttribute("aria-expanded", "false");
});

it("opening one reveals its body", async () => {
  const user = userEvent.setup();
  open();
  await user.click(fold("Public holidays")!);
  expect(screen.getByText("the holiday calendar")).toBeInTheDocument();
});

/* One at a time. Both open at once is the long scrolling menu this change
   exists to remove, and it would also leave two live fetches on screen. */
it("opening the second closes the first", async () => {
  const user = userEvent.setup();
  open();
  await user.click(fold("Public holidays")!);
  await user.click(fold("Xero payroll")!);
  expect(screen.getByText("the payroll roster")).toBeInTheDocument();
  expect(screen.queryByText("the holiday calendar")).not.toBeInTheDocument();
});

it("pressing an open section again shuts it", async () => {
  const user = userEvent.setup();
  open();
  const row = fold("Public holidays")!;
  await user.click(row);
  await user.click(row);
  expect(screen.queryByText("the holiday calendar")).not.toBeInTheDocument();
});

/* The gating is unchanged by the reordering: holidays are admin+, Xero is
   `financials` like every other pay control. */
it("an admin without `financials` still gets holidays, and still gets no Xero", () => {
  open({ canPay: false });
  expect(fold("Public holidays")!).toBeInTheDocument();
  expect(fold("Xero payroll")).not.toBeInTheDocument();
  expect(screen.queryByText("Pay cycle")).not.toBeInTheDocument();
});

it("offers neither row when this workspace has neither to offer", () => {
  open({ holidays: false, xero: false });
  expect(fold("Public holidays")).not.toBeInTheDocument();
  expect(fold("Xero payroll")).not.toBeInTheDocument();
  expect(screen.getByText("Pay cycle")).toBeInTheDocument();
});
