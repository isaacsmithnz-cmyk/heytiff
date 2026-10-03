import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JobMoneyBlock } from "../job-money-block";
import type { FamilyMoney } from "@/lib/workboard/job-family";

/* THE DEPOSIT TICK on Billing (Isaac, 2026-10-03: "if no deposit required
   make that as an option so it can get ticked off"). */

const family: FamilyMoney = {
  memberCount: 1,
  isFamily: false,
  claims: [],
  valueCents: 300000,
  basis: "inc",
  mixedBasis: false,
  unknownClaim: false,
  invoicedCents: 0,
  toComeCents: 300000,
  paidCents: 0,
  awaitingCents: 0,
};

const block = (deposit: Parameters<typeof JobMoneyBlock>[0]["deposit"]) =>
  render(<JobMoneyBlock family={family} money={null} ledgerPaidCents={0} statusLabel="Work Order" deposit={deposit} />);

it("asks, and the press ticks it", async () => {
  const onSet = jest.fn();
  block({ noDeposit: false, busy: false, error: null, onSet });
  expect(screen.getByText("None invoiced")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "No deposit needed" }));
  expect(onSet).toHaveBeenCalledWith(true);
});

it("ticked, it says so and can be taken back", async () => {
  const onSet = jest.fn();
  block({ noDeposit: true, busy: false, error: null, onSet });
  expect(screen.getByText("Not needed on this job")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(onSet).toHaveBeenCalledWith(false);
});

it("says why a press didn't save, and draws nothing where there is nothing to ask", () => {
  const { unmount } = block({ noDeposit: false, busy: false, error: "That didn't save. Try again.", onSet: jest.fn() });
  expect(screen.getByText("That didn't save. Try again.")).toBeTruthy();
  unmount();
  block(null);
  expect(screen.queryByText("Deposit")).toBeNull();
});
