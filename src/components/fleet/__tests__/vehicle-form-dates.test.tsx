import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VehicleFormModal } from "../modals";
import type { Vehicle } from "../logic";

jest.mock("@/app/actions/fleet-ai", () => ({
  readFuelReceipt: jest.fn(async () => ({ ok: false, reason: "no-key" })),
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

const field = (label: string) => screen.getByLabelText(label);

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
  await user.type(screen.getByPlaceholderText("e.g. Toyota"), "Toyota");

  await user.click(field("Rego expiry"));
  await user.click(screen.getByRole("button", { name: "Friday 31 July 2026" }));
  expect(field("Rego expiry")).toHaveTextContent("31/07/2026");

  await user.click(screen.getByRole("button", { name: /add vehicle/i }));
  const saved = onSave.mock.calls[0][0] as Vehicle;
  expect(saved.regoDays).toBe(6); // 25 -> 31 July
  expect(saved.insuranceDays).toBe(365); // untouched fields keep their defaults
  expect(saved.purchaseDateDays).toBe(0);
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
