import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VehicleFormModal } from "../modals";
import type { Vehicle } from "../logic";

/* The purchase invoice (issue #509, slice 1). The contract under test is the
   fuel docket's, transplanted: upload and scan run together, the SCAN fills
   the fields the person is looking at (the form is the confirm step), and the
   UPLOAD's document id rides the save so the action can adopt it onto a row
   that may not exist yet. The seams that matter: a failed scan must still
   attach the file, and a failed upload must attach nothing. */

const uploadFile = jest.fn();
jest.mock("@/lib/documents/upload-client", () => ({
  uploadFile: (...a: unknown[]) => uploadFile(...a),
}));

const readPurchaseInvoice = jest.fn();
jest.mock("@/app/actions/fleet-ai", () => ({
  readFuelReceipt: jest.fn(async () => ({ ok: false, reason: "no-key" })),
  readPurchaseInvoice: (...a: unknown[]) => readPurchaseInvoice(...a),
}));

const TODAY = "2026-08-24";

function setup() {
  const onSave = jest.fn();
  render(
    <VehicleFormModal initial={null} staff={[]} today={TODAY} onSave={onSave} onClose={jest.fn()} />,
  );
  return { onSave, user: userEvent.setup() };
}

const attachButton = () => screen.getByRole("button", { name: /attach the invoice/i });
const priceInput = () => screen.getByPlaceholderText("What you paid");
const pickFile = async (user: ReturnType<typeof userEvent.setup>) => {
  const file = new File(["pdf-bytes"], "tax-invoice.pdf", { type: "application/pdf" });
  const input = document.querySelector('input[type="file"][accept*="pdf"]') as HTMLInputElement;
  await user.upload(input, file);
};

beforeEach(() => {
  jest.clearAllMocks();
  uploadFile.mockResolvedValue({
    ok: true,
    file: { documentId: "doc-1", fileName: "tax-invoice.pdf", mimeType: "application/pdf", sizeBytes: 9, previewUrl: null },
  });
  readPurchaseInvoice.mockResolvedValue({
    ok: true,
    cost: 45000,
    purchasedOn: "2024-03-15",
    supplier: "Sydney City Toyota",
  });
});

it("fills the price and date from the scan — the form is the confirm step", async () => {
  const { user } = setup();
  await pickFile(user);

  await waitFor(() => expect(priceInput()).toHaveValue(45000));
  expect(screen.getByLabelText("Purchase date")).toHaveTextContent("15/03/2024");
  expect(screen.getByText(/tax-invoice\.pdf/)).toBeInTheDocument();
  expect(uploadFile).toHaveBeenCalledWith(expect.anything(), "purchase_invoice");
});

it("hands the save the document id, so the action can adopt it", async () => {
  const { user, onSave } = setup();
  await user.type(screen.getByPlaceholderText("e.g. MKT482"), "MKT482");
  await user.selectOptions(screen.getByRole("combobox", { name: /^Make/ }), "Toyota");
  await pickFile(user);
  await waitFor(() => expect(priceInput()).toHaveValue(45000));

  await user.click(screen.getByRole("button", { name: /add vehicle/i }));
  expect(onSave.mock.calls[0][1]).toBe("doc-1");
});

it("a failed scan still attaches the file — evidence beats extraction", async () => {
  readPurchaseInvoice.mockResolvedValue({ ok: false, reason: "read" });
  const { user, onSave } = setup();
  await user.type(screen.getByPlaceholderText("e.g. MKT482"), "MKT482");
  await user.selectOptions(screen.getByRole("combobox", { name: /^Make/ }), "Toyota");
  await pickFile(user);

  await waitFor(() => expect(screen.getByText(/tax-invoice\.pdf/)).toBeInTheDocument());
  expect(priceInput()).toHaveValue(null); // nothing invented
  await user.click(screen.getByRole("button", { name: /add vehicle/i }));
  expect(onSave.mock.calls[0][1]).toBe("doc-1"); // the paper still lands
});

it("a failed upload attaches nothing and offers the button again", async () => {
  uploadFile.mockResolvedValue({ ok: false, error: "too big" });
  const { user, onSave } = setup();
  await user.type(screen.getByPlaceholderText("e.g. MKT482"), "MKT482");
  await user.selectOptions(screen.getByRole("combobox", { name: /^Make/ }), "Toyota");
  await pickFile(user);

  await waitFor(() => expect(attachButton()).toBeEnabled());
  await user.click(screen.getByRole("button", { name: /add vehicle/i }));
  expect(onSave.mock.calls[0][1]).toBeUndefined(); // no orphan id rides the save
});

it("scanned values do not overwrite what a failed field would keep", async () => {
  readPurchaseInvoice.mockResolvedValue({ ok: true, cost: null, purchasedOn: "2024-03-15", supplier: null });
  const { user } = setup();
  await user.type(priceInput(), "41000");
  await pickFile(user);

  await waitFor(() => expect(screen.getByLabelText("Purchase date")).toHaveTextContent("15/03/2024"));
  expect(priceInput()).toHaveValue(41000); // the null cost left the typed price alone
});
