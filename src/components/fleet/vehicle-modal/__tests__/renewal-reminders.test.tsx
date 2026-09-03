import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RenewalReminder } from "@/lib/fleet/reminders";
import type { RenewalKind, Vehicle } from "../../logic";
import { RenewalScreen } from "../renewal-screen";

/* The REMIND ME chips. A chip is on when the viewer has an open reminder task
   for that lead; pressing asks the register to create or clear it; and with
   nothing recorded there is no expiry to count from, so nothing to press. */

jest.mock("@/lib/documents/upload-client", () => ({ uploadFile: jest.fn() }));
jest.mock("@/app/actions/fleet-ai", () => ({
  readRenewalDocument: jest.fn(async () => ({ ok: false, reason: "no-key" })),
}));

const TODAY = "2026-09-03";

const van: Vehicle = {
  id: "v1",
  name: "WORK TRITON",
  make: "Mitsubishi",
  model: "Triton",
  year: 2022,
  plate: "YLI59V",
  plateState: "NSW",
  status: "active",
  odometer: 108375,
  regoDays: 391,
  insuranceDays: null,
  ctpDays: 391,
  serviceIntervalKm: 10000,
  lastServiceOdo: 100000,
  serviceIntervalMonths: null,
  serviceDays: null,
  motorised: true,
  assignedTo: null,
  value: 27000,
  purchasePrice: 41990,
  purchaseDateDays: 597,
  lastServiceDays: 41,
};

function mount(kind: RenewalKind, reminders: RenewalReminder[]) {
  const onRemind = jest.fn();
  render(
    <RenewalScreen
      vehicle={van}
      kind={kind}
      today={TODAY}
      documents={[]}
      policies={[]}
      pending={false}
      error={null}
      onBack={jest.fn()}
      onSave={jest.fn()}
      onAttach={jest.fn()}
      reminders={reminders}
      onRemind={onRemind}
    />,
  );
  return { onRemind, user: userEvent.setup() };
}

const LEADS = ["30 days before", "14 days before", "7 days before", "On expiry"];

it("shows which chips are on, from the viewer's own reminders", () => {
  mount("rego", [{ taskId: "t1", kind: "rego", leadDays: 30, dueDate: "2027-08-30" }]);
  expect(screen.getByRole("button", { name: "30 days before" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "14 days before" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("button", { name: "On expiry" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByText("Before it expires")).toBeInTheDocument();
});

it("pressing a chip asks for the reminder, pressing it again asks to clear it", async () => {
  const { onRemind, user } = mount("rego", [{ taskId: "t1", kind: "rego", leadDays: 30, dueDate: "2027-08-30" }]);
  await user.click(screen.getByRole("button", { name: "14 days before" }));
  expect(onRemind).toHaveBeenCalledWith(14, true);
  await user.click(screen.getByRole("button", { name: "30 days before" }));
  expect(onRemind).toHaveBeenCalledWith(30, false);
});

it("cannot set a reminder before there is an expiry to count from", () => {
  mount("insurance", []);
  expect(screen.getByText("Record the renewal first")).toBeInTheDocument();
  for (const label of LEADS) expect(screen.getByRole("button", { name: label })).toBeDisabled();
});
