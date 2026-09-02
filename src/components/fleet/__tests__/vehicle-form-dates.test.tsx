import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VehicleFormModal } from "../modals";
import type { Vehicle } from "../logic";

jest.mock("@/app/actions/fleet-ai", () => ({
  readFuelReceipt: jest.fn(async () => ({ ok: false, reason: "no-key" })),
}));
// storing the docket reaches a server action too — same rule, and mocking it
// keeps auth0's ESM out of the module graph
jest.mock("@/lib/documents/upload-client", () => ({
  uploadFile: jest.fn(async () => ({ ok: false, error: "not in a test" })),
}));

/* The vehicle form is where the date picker is hardest: this modal portals to
   <body>, outside the `.fg` frame, and closes itself on a document-level
   Escape. The picker has to open above it, report ISO, and swallow its own
   Escape — otherwise dismissing the calendar takes the half-filled form with
   it. Expiries are also the fields most likely to be read off a windscreen
   sticker, which is exactly where dd/mm vs mm/dd goes wrong silently. */

const TODAY = "2026-07-25";

function setup() {
  const onSave = jest.fn();
  const onClose = jest.fn();
  render(
    <VehicleFormModal initial={null} staff={[]} today={TODAY} onSave={onSave} onClose={onClose} />,
  );
  return { onSave, onClose, user: userEvent.setup() };
}

/* RegExp as well as string: a Field's <label> wraps its hint, so a field that
   carries one has the hint in its accessible name — which is right for a
   screen reader and means an exact-string query misses it. */
const field = (label: string | RegExp) => screen.getByLabelText(label);

const vehicle = (over: Partial<Vehicle> = {}): Vehicle => ({
  id: "v1",
  name: "VRF-04",
  make: "Toyota",
  model: "Hiace",
  year: 2022,
  plate: "MKT482",
  plateState: "NSW",
  status: "active",
  odometer: 84120,
  regoDays: 70,
  insuranceDays: 70,
  ctpDays: 70,
  serviceIntervalKm: 10000,
  lastServiceOdo: 80000,
  serviceIntervalMonths: null,
  serviceDays: null,
  motorised: true,
  assignedTo: null,
  value: 52000,
  purchasePrice: 0,
  purchaseDateDays: 0,
  lastServiceDays: null,
  ...over,
});

it("takes no typed dates at all — every date field is a picker", () => {
  setup();
  expect(document.querySelectorAll('input[type="date"]')).toHaveLength(0);
  for (const label of ["Rego expiry", "Insurance expiry", "Purchase date"]) {
    expect(field(label).tagName).toBe("BUTTON");
    expect(field(label)).toHaveTextContent("dd/mm/yyyy");
  }
});

it("opens the calendar over the modal and saves the pick as a day count", async () => {
  const { user, onSave } = setup();

  await user.type(screen.getByPlaceholderText("e.g. MKT482"), "MKT482");
  await user.selectOptions(screen.getByRole("combobox", { name: /^Make/ }), "Toyota");

  await user.click(field("Rego expiry"));
  await user.click(screen.getByRole("button", { name: "Friday 31 July 2026" }));
  expect(field("Rego expiry")).toHaveTextContent("31/07/2026");

  await user.click(screen.getByRole("button", { name: /add vehicle/i }));
  const saved = onSave.mock.calls[0][0] as Vehicle;
  expect(saved.regoDays).toBe(6); // 25 -> 31 July
  // a field nobody filled in saves as nothing — not as a date a year out
  expect(saved.insuranceDays).toBeNull();
  expect(saved.ctpDays).toBeNull();
  expect(saved.purchaseDateDays).toBe(0);
});

/* The bug this closes: an unset expiry used to reach the form as today+365 and
   render as a real date in the picker. Someone opening a vehicle to change its
   odometer saw renewal dates nobody had entered, and pressing Save wrote them.
   Blank in, blank shown, blank out. */
it("leaves an expiry nobody has entered blank, and saves it that way", async () => {
  const onSave = jest.fn();
  render(
    <VehicleFormModal
      initial={vehicle({ regoDays: null, insuranceDays: null, ctpDays: null })}
      staff={[]}
      today={TODAY}
      onSave={onSave}
      onClose={jest.fn()}
    />,
  );
  const user = userEvent.setup();

  for (const label of ["Rego expiry", "Insurance expiry", /^Green slip expiry/]) {
    expect(field(label)).toHaveTextContent("dd/mm/yyyy");
  }

  await user.click(screen.getByRole("button", { name: /save/i }));
  const saved = onSave.mock.calls[0][0] as Vehicle;
  expect(saved.regoDays).toBeNull();
  expect(saved.insuranceDays).toBeNull();
  expect(saved.ctpDays).toBeNull();
});

it("Escape shuts the calendar, not the form behind it", async () => {
  const { user, onClose } = setup();
  await user.click(field("Purchase date"));
  expect(screen.getByRole("dialog")).toBeInTheDocument();

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();

  // and once the calendar is gone, Escape belongs to the modal again
  await user.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalled();
});

it("clears a date back to empty rather than stranding a wrong one", async () => {
  const { user } = setup();
  await user.click(field("Insurance expiry"));
  await user.click(screen.getByRole("button", { name: "Today" }));
  expect(field("Insurance expiry")).toHaveTextContent("25/07/2026");

  await user.click(field("Insurance expiry"));
  await user.click(screen.getByRole("button", { name: "Clear" }));
  expect(field("Insurance expiry")).toHaveTextContent("dd/mm/yyyy");
});
