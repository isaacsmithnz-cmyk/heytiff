/* Edit customer, the v2 dialog (Isaac, 25 October 2026: "Edit customer's
   six role chips become one Role chooser"): the customer and their address,
   each contact a card with its role one chooser and Remove contact, where
   the bills go, and Save to ServiceM8, which sends what the form holds. */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CustomerForm } from "@/lib/integrations/sm8-customer-plan";

const readCustomerForEdit = jest.fn();
const saveCustomer = jest.fn();
jest.mock("@/app/actions/job-customer", () => ({
  readCustomerForEdit: (...a: unknown[]) => readCustomerForEdit(...a),
  saveCustomer: (...a: unknown[]) => saveCustomer(...a),
}));

import { JobCustomerDialog } from "../job-customer-dialog";

const form = (): CustomerForm => ({
  jobUuid: "j-1",
  company: { uuid: "c-1", name: "Chandra Jayasinghe", address: "105 Shadforth Street, Mosman NSW 2088" },
  billingAddress: "PO Box 12, Mosman NSW 2088",
  contacts: [
    { uuid: "p-1", first: "Chandra", last: "Jayasinghe", mobile: "0400 000 000", phone: "", email: "c@example.com", type: "JOB" },
    { uuid: "p-2", first: "Ravi", last: "", mobile: "", phone: "", email: "", type: "Tenant" },
  ],
});

const onClose = jest.fn();
const onSaved = jest.fn();
const open = async () => {
  render(<JobCustomerDialog jobUuid="j-1" onClose={onClose} onSaved={onSaved} />);
  return within(await screen.findByRole("dialog", { name: "Edit customer" }));
};

beforeEach(() => {
  jest.clearAllMocks();
  readCustomerForEdit.mockResolvedValue({ ok: true, form: form(), siteAddress: "105 Shadforth Street, Mosman NSW 2088", billingRead: true });
  saveCustomer.mockResolvedValue({ ok: true, saved: 1, waiting: 0, failed: [] });
});

it("is the v2 dialog, its fields labelled above them", async () => {
  const dialog = await open();
  expect(screen.getByRole("dialog", { name: "Edit customer" })).toHaveClass("pt-dialog", "pt-dialog--560");
  expect(await dialog.findByLabelText("Customer")).toHaveValue("Chandra Jayasinghe");
  expect(dialog.getByLabelText("Address")).toHaveValue("105 Shadforth Street, Mosman NSW 2088");
  expect(dialog.getByLabelText("Bills go to")).toHaveValue("PO Box 12, Mosman NSW 2088");
  expect(dialog.getByRole("heading", { name: "Contacts" })).toBeInTheDocument();
  const first = within(dialog.getByRole("group", { name: "Contact 1" }));
  expect(first.getByLabelText("First name")).toHaveValue("Chandra");
  expect(first.getByLabelText("Last name")).toHaveValue("Jayasinghe");
  expect(first.getByLabelText("Mobile")).toHaveValue("0400 000 000");
  expect(first.getByLabelText("Email")).toHaveValue("c@example.com");
  expect(dialog.getByRole("button", { name: "Save to ServiceM8" })).toHaveClass("pt-btn--main");
  expect(dialog.getByRole("button", { name: "Cancel" })).toHaveClass("pt-btn--second");
  expect(screen.getByRole("dialog", { name: "Edit customer" }).querySelector('[class*="wb2-"], .pbtn, [class*="njob"]')).toBeNull();
});

it("gives each contact one Role chooser, not six chips", async () => {
  const dialog = await open();
  const first = within(await dialog.findByRole("group", { name: "Contact 1" }));
  expect(first.queryAllByRole("radio")).toHaveLength(0);
  const role = first.getByRole("combobox", { name: "Role" });
  expect(role).toHaveTextContent("Job contact");
  expect(within(dialog.getByRole("group", { name: "Contact 2" })).getByRole("combobox", { name: "Role" })).toHaveTextContent("Tenant");
  await userEvent.click(role);
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
    "Job contact",
    "Billing contact",
    "Site contact",
    "Property manager",
    "Property owner",
    "Tenant",
  ]);
  await userEvent.click(screen.getByRole("option", { name: "Billing contact" }));
  expect(role).toHaveTextContent("Billing contact");

  await userEvent.click(dialog.getByRole("button", { name: "Save to ServiceM8" }));
  await waitFor(() => expect(saveCustomer).toHaveBeenCalled());
  expect((saveCustomer.mock.calls[0]![1] as CustomerForm).contacts[0]!.type).toBe("BILLING");
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith("Saved to ServiceM8. The card catches up within a minute."));
  expect(onClose).toHaveBeenCalled();
});

it("removes a contact, adds a blank one, and fills the bills from the site", async () => {
  const dialog = await open();
  await dialog.findByRole("group", { name: "Contact 2" });
  const remove = within(dialog.getByRole("group", { name: "Contact 2" })).getByRole("button", { name: "Remove contact" });
  expect(remove).toHaveClass("pt-btn--delete");
  await userEvent.click(remove);
  expect(dialog.queryByRole("group", { name: "Contact 2" })).toBeNull();
  await userEvent.click(dialog.getByRole("button", { name: "Add a contact" }));
  const added = within(dialog.getByRole("group", { name: "Contact 2" }));
  expect(added.getByLabelText("First name")).toHaveValue("");
  expect(added.getByRole("combobox", { name: "Role" })).toHaveTextContent("Job contact");

  await userEvent.click(dialog.getByRole("button", { name: "Same as the site" }));
  expect(dialog.getByLabelText("Bills go to")).toHaveValue("105 Shadforth Street, Mosman NSW 2088");
  expect(dialog.queryByRole("button", { name: "Same as the site" })).toBeNull();
});

it("keeps the dialog open and says why when ServiceM8 refuses a change", async () => {
  saveCustomer.mockResolvedValueOnce({ ok: true, saved: 0, waiting: 0, failed: ["ServiceM8 refused the email address."] });
  const dialog = await open();
  await dialog.findByLabelText("Customer");
  await userEvent.click(dialog.getByRole("button", { name: "Save to ServiceM8" }));
  expect(await dialog.findByText("ServiceM8 refused the email address.")).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
  expect(onSaved).not.toHaveBeenCalled();
});

it("says what went wrong when the customer can't be read", async () => {
  readCustomerForEdit.mockResolvedValueOnce({ ok: false, error: "Couldn't read the customer from ServiceM8." });
  const dialog = await open();
  expect(await dialog.findByText("Couldn't read the customer from ServiceM8.")).toBeInTheDocument();
  expect(dialog.getByRole("button", { name: "Save to ServiceM8" })).toBeDisabled();
});
