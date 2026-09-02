import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VehicleFormModal } from "../modals";
import type { Vehicle } from "../logic";

jest.mock("@/app/actions/fleet-ai", () => ({
  readFuelReceipt: jest.fn(async () => ({ ok: false, reason: "no-key" })),
}));
jest.mock("@/lib/documents/upload-client", () => ({
  uploadFile: jest.fn(async () => ({ ok: false, error: "not in a test" })),
}));

/* Make used to be a free-text box, and a real register came out of it holding
   "TOYOTA" and "Toyota" as two marques — nothing could group or count them.
   The fix is a picker, but a picker alone would refuse the trailer, whose make
   is a feed code no list carries. Both halves have to hold: the common case
   can only be picked, and the uncommon one can still be typed. */

const TODAY = "2026-07-25";

const VAN: Vehicle = {
  id: "v1",
  name: "ZUCKY",
  make: "TOYOTA", // as a free-text field left it
  model: "Hiace",
  year: 2022,
  plate: "EVD72G",
  plateState: "NSW",
  status: "active",
  odometer: 55500,
  regoDays: 109,
  insuranceDays: 300,
  ctpDays: 300,
  serviceIntervalKm: 10000,
  lastServiceOdo: 50000,
  serviceIntervalMonths: null,
  serviceDays: null,
  motorised: true,
  assignedTo: null,
  value: 45000,
  purchasePrice: 0,
  purchaseDateDays: 0,
  lastServiceDays: null,
};

function setup(initial: Vehicle | null = null) {
  const onSave = jest.fn();
  render(
    <VehicleFormModal
      initial={initial}
      staff={[]}
      today={TODAY}
      onSave={onSave}
      onClose={jest.fn()}
    />,
  );
  return { onSave, user: userEvent.setup() };
}

const makeSelect = () => screen.getByRole("combobox", { name: /^Make/ });
const addBtn = () => screen.getByRole("button", { name: /add vehicle/i });

it("cannot be typed into — Make is a picker", () => {
  setup();
  expect(makeSelect().tagName).toBe("SELECT");
  expect(screen.queryByPlaceholderText("e.g. Toyota")).not.toBeInTheDocument();
});

it("saves the list's spelling, not whatever case was clicked", async () => {
  const { user, onSave } = setup();
  await user.type(screen.getByPlaceholderText("e.g. MKT482"), "MKT482");
  await user.selectOptions(makeSelect(), "Toyota");
  await user.click(addBtn());
  expect((onSave.mock.calls[0][0] as Vehicle).make).toBe("Toyota");
});

it("preselects the canonical row for a dirty spelling already in the register", async () => {
  const { user, onSave } = setup(VAN);
  // opened on "TOYOTA" — the picker must find its row rather than fall to "Not listed"
  expect(makeSelect()).toHaveValue("Toyota");
  expect(screen.queryByLabelText("Make not listed")).not.toBeInTheDocument();

  // and saving an otherwise untouched vehicle tidies it on the way out
  await user.click(screen.getByRole("button", { name: /save/i }));
  expect((onSave.mock.calls[0][0] as Vehicle).make).toBe("Toyota");
});

it("takes a make no list will ever carry, once you say it is not listed", async () => {
  const { user, onSave } = setup();
  await user.type(screen.getByPlaceholderText("e.g. MKT482"), "TC22BJ");

  expect(screen.queryByLabelText("Make not listed")).not.toBeInTheDocument();
  await user.selectOptions(makeSelect(), "__not_listed__");

  await user.type(screen.getByLabelText("Make not listed"), "LG Chiv");
  await user.click(addBtn());
  expect((onSave.mock.calls[0][0] as Vehicle).make).toBe("LG Chiv");
});

it("reopens an unlisted make in the text box instead of quietly rewriting it", () => {
  setup({ ...VAN, make: "LG Chiv" });
  expect(makeSelect()).toHaveValue("__not_listed__");
  expect(screen.getByLabelText("Make not listed")).toHaveValue("LG Chiv");
});

it("clears the previous pick, so 'not listed' can't save the make you abandoned", async () => {
  const { user } = setup();
  await user.type(screen.getByPlaceholderText("e.g. MKT482"), "MKT482");
  await user.selectOptions(makeSelect(), "Toyota");
  expect(addBtn()).toBeEnabled();

  await user.selectOptions(makeSelect(), "__not_listed__");
  expect(screen.getByLabelText("Make not listed")).toHaveValue("");
  expect(addBtn()).toBeDisabled();
});
