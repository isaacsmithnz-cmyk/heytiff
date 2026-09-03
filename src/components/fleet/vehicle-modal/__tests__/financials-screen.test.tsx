import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StoredDocument } from "@/lib/documents/query";
import type { Vehicle, VehicleFinance } from "../../logic";
import { FinancialsScreen } from "../financials-screen";

/* The Financials screen. What these pin: an absent agreement is an absent
   record (never "owned outright"); the position is the schedule's arithmetic
   with the lender's name on the caveat; a scanned agreement fills the panel
   and saves as a scan; the purchase and the book value edit in place through
   the vehicle's own save. */

const uploadFile = jest.fn();
jest.mock("@/lib/documents/upload-client", () => ({
  uploadFile: (...a: unknown[]) => uploadFile(...a),
}));
const readFinanceAgreement = jest.fn();
jest.mock("@/app/actions/fleet-ai", () => ({
  readFinanceAgreement: (...a: unknown[]) => readFinanceAgreement(...a),
}));
jest.mock("@/lib/images/upright", () => ({
  fileToUprightBase64: jest.fn(async () => ({ data: "AAAA", mediaType: "image/jpeg" })),
}));

const TODAY = "2026-09-03";

const triton: Vehicle = {
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
  insuranceDays: 20,
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
  purchaseSupplier: null,
  purchaseInvoiceNo: null,
  purchaseExGst: null,
  purchaseGst: null,
  purchaseOnRoad: null,
  purchaseDeposit: 4000,
  purchaseOdometer: null,
};

const agreement: VehicleFinance = {
  id: "f1",
  lender: "Macquarie Leasing",
  agreementNo: "402193",
  kind: "chattel_mortgage",
  startsOn: "2022-09-01",
  termMonths: 60,
  repayment: 742,
  frequency: "monthly",
  ratePct: 7.45,
  balloon: 12000,
  amountFinanced: 38500,
  documentId: "d-agr",
  source: "scan",
  createdAt: "2022-09-02",
};

const contract: StoredDocument = {
  id: "d-agr",
  kind: "finance_agreement",
  fileName: "Finance-agreement-402193.pdf",
  mimeType: "application/pdf",
  sizeBytes: 412_009,
  uploadedById: "s1",
  createdAt: "2022-09-02",
  url: null,
  image: false,
  policyId: null,
  financeId: "f1",
};

function mount(over: { finance?: VehicleFinance[]; documents?: StoredDocument[]; valuation?: boolean; vehicle?: Partial<Vehicle> } = {}) {
  const onSaveVehicle = jest.fn();
  const onRecordFinance = jest.fn();
  const onAttachFinance = jest.fn();
  const onAttachInvoice = jest.fn();
  const onBack = jest.fn();
  render(
    <FinancialsScreen
      vehicle={{ ...triton, ...over.vehicle }}
      today={TODAY}
      valuation={
        over.valuation === false
          ? undefined
          : { point: 27000, low: 24500, high: 29500, note: "2022 Triton GLX+ utes at similar km", atOdo: 107900 }
      }
      valuationIsStale={false}
      documents={over.documents ?? []}
      policies={[]}
      logs={[]}
      finance={over.finance ?? []}
      pending={false}
      error={null}
      onBack={onBack}
      onSaveVehicle={onSaveVehicle}
      onRecordFinance={onRecordFinance}
      onAttachFinance={onAttachFinance}
      onAttachInvoice={onAttachInvoice}
    />,
  );
  return { onSaveVehicle, onRecordFinance, onAttachFinance, onAttachInvoice, onBack, user: userEvent.setup() };
}

const card = (eyebrow: string): HTMLElement => screen.getByText(eyebrow).closest(".vm-card") as HTMLElement;

beforeEach(() => {
  uploadFile.mockReset();
  readFinanceAgreement.mockReset();
});

it("with no agreement, offers to add one and claims nothing about ownership", () => {
  mount();
  expect(screen.getByText("No finance agreement recorded")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add finance agreement" })).toBeInTheDocument();
  // the purchase grid says the same thing in its own words
  expect(screen.getByText("No finance recorded")).toBeInTheDocument();
  expect(screen.getByText("PAID")).toBeInTheDocument();
  // and the cost to run has no finance line — the one FINANCE on screen is the card's eyebrow
  expect(screen.getAllByText("FINANCE")).toHaveLength(1);
});

it("shows the agreement as the lender wrote it and where the schedule stands", () => {
  mount({ finance: [agreement], documents: [contract] });
  expect(screen.getByText("FINANCE AGREEMENT")).toBeInTheDocument();
  expect(screen.getByText("$742 / month")).toBeInTheDocument();
  expect(screen.getByText("1 Sep 2027")).toBeInTheDocument(); // ENDS: start plus term
  expect(screen.getByText("48 of 60")).toBeInTheDocument();
  expect(screen.getByText("~$20,904")).toBeInTheDocument(); // 12 × $742 + $12,000 balloon
  expect(screen.getByText(/confirm the payout figure with Macquarie Leasing/)).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "Repayments fallen due" })).toHaveAttribute("aria-valuenow", "48");
  // the purchase grid now reads as financed
  expect(screen.getByText("DEPOSIT PAID")).toBeInTheDocument();
  expect(screen.getByText("BALANCE FINANCED")).toBeInTheDocument();
  expect(screen.getByText("Deposit + finance")).toBeInTheDocument();
  // a year of repayments in the cost to run — the finance line, and the total it is all of
  expect(within(card("COST TO RUN · LAST 12 MONTHS")).getAllByText("$8,904")).toHaveLength(2);
  // and the contract filed under it
  expect(screen.getByText(/Finance-agreement-402193\.pdf/)).toBeInTheDocument();
});

it("scanning an agreement fills the panel, and Save agreement records it as a scan", async () => {
  const { onRecordFinance, user } = mount();
  uploadFile.mockResolvedValue({
    ok: true,
    file: { documentId: "d9", fileName: "loan.pdf", mimeType: "application/pdf", sizeBytes: 10, previewUrl: null },
  });
  readFinanceAgreement.mockResolvedValue({
    ok: true,
    lender: "Toyota Finance",
    agreementNo: "TF-1",
    kind: "loan",
    startsOn: "2026-07-01",
    termMonths: 48,
    repayment: 610,
    frequency: "monthly",
    ratePct: 6.9,
    balloon: null,
    amountFinanced: 30000,
  });

  await user.click(screen.getByRole("button", { name: "Add finance agreement" }));
  await user.upload(screen.getByLabelText("Scan document"), new File(["x"], "loan.pdf", { type: "application/pdf" }));
  await waitFor(() => expect(screen.getByDisplayValue("Toyota Finance")).toBeInTheDocument());
  expect(uploadFile).toHaveBeenCalledWith(expect.any(File), "finance_agreement");
  expect(screen.getByLabelText("Agreement type")).toHaveValue("loan");
  expect(screen.getByLabelText("Term")).toHaveValue("48");

  await user.click(screen.getByRole("button", { name: "Save agreement" }));
  expect(onRecordFinance).toHaveBeenCalledWith(
    expect.objectContaining({
      lender: "Toyota Finance",
      agreementNo: "TF-1",
      kind: "loan",
      startsOn: "2026-07-01",
      termMonths: 48,
      repayment: 610,
      frequency: "monthly",
      ratePct: 6.9,
      balloon: null,
      amountFinanced: 30000,
      documentId: "d9",
      source: "scan",
    }),
  );
});

it("will not save an agreement without a lender and a start date", async () => {
  const { user } = mount();
  await user.click(screen.getByRole("button", { name: "Add finance agreement" }));
  await user.click(screen.getByRole("button", { name: "Enter manually" }));
  const save = screen.getByRole("button", { name: "Save agreement" });
  expect(save).toBeDisabled();
  await user.type(screen.getByPlaceholderText("e.g. Macquarie Leasing"), "Westpac");
  expect(save).toBeDisabled(); // still no start date
});

it("edits the book value in place through the vehicle's own save", async () => {
  const { onSaveVehicle, user } = mount();
  await user.click(within(screen.getByText("BOOK VALUE").parentElement as HTMLElement).getByRole("button", { name: "Edit" }));
  const input = screen.getByLabelText("Book value");
  await user.clear(input);
  await user.type(input, "25000");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(onSaveVehicle).toHaveBeenCalledWith(expect.objectContaining({ id: "v1", value: 25000 }));
});

it("edits the purchase as the invoice prints it", async () => {
  const { onSaveVehicle, user } = mount();
  await user.click(within(card("PURCHASE")).getByRole("button", { name: "Edit" }));
  await user.type(screen.getByPlaceholderText("Dealer or seller"), "Sydney City Mitsubishi");
  await user.type(screen.getByLabelText("GST"), "3635.45");
  await user.click(screen.getByRole("button", { name: "Save purchase" }));
  expect(onSaveVehicle).toHaveBeenCalledWith(
    expect.objectContaining({
      purchaseSupplier: "Sydney City Mitsubishi",
      purchaseGst: 3635.45,
      purchasePrice: 41990, // untouched fields carry through
      purchaseDeposit: 4000,
      purchaseOnRoad: null, // a blank stays a blank, never $0
    }),
  );
});

it("Add document under INVOICES files a purchase invoice against the vehicle", async () => {
  const { onAttachInvoice, user } = mount();
  uploadFile.mockResolvedValue({
    ok: true,
    file: { documentId: "d7", fileName: "tax-invoice.pdf", mimeType: "application/pdf", sizeBytes: 10, previewUrl: null },
  });
  await user.upload(screen.getByLabelText("Add invoice"), new File(["x"], "tax-invoice.pdf", { type: "application/pdf" }));
  await waitFor(() => expect(onAttachInvoice).toHaveBeenCalledWith("d7"));
  expect(uploadFile).toHaveBeenCalledWith(expect.any(File), "purchase_invoice");
});

it("without a Tiff estimate shows the book value and says how to get one", () => {
  mount({ valuation: false });
  expect(screen.getByText("VALUE")).toBeInTheDocument();
  expect(screen.getByText(/Run “Value with Tiff” in the register/)).toBeInTheDocument();
  expect(screen.queryByText("TIFF VALUE")).not.toBeInTheDocument();
});

it("Cancel goes back to the card", async () => {
  const { onBack, user } = mount();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onBack).toHaveBeenCalled();
});
