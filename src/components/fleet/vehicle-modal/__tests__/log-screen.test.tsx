import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FleetActions } from "../../fleet-state";
import type { NewLog, Vehicle } from "../../logic";
import { VehicleModal } from "..";

/* Logging as a screen of the card. What is under test is what Save hands the
   register's addLog — the stored document, the tax figures, the paper's date,
   whose money — and that the screen comes and goes the way the others do. The
   reading is a server action, mocked as it must be. */

const uploadFile = jest.fn();
jest.mock("@/lib/documents/upload-client", () => ({
  uploadFile: (...a: unknown[]) => uploadFile(...a),
}));
const readFuelReceipt = jest.fn();
const readServiceRecord = jest.fn();
jest.mock("@/app/actions/fleet-ai", () => ({
  readFuelReceipt: (...a: unknown[]) => readFuelReceipt(...a),
  readServiceRecord: (...a: unknown[]) => readServiceRecord(...a),
  readRenewalDocument: jest.fn(async () => ({ ok: false, reason: "no-key" })),
  readFinanceAgreement: jest.fn(async () => ({ ok: false, reason: "no-key" })),
  readPurchaseInvoice: jest.fn(async () => ({ ok: false, reason: "no-key" })),
}));

const TODAY = "2026-09-02";

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
  regoDays: 200,
  insuranceDays: null,
  ctpDays: 392,
  serviceIntervalKm: 10000,
  lastServiceOdo: 100000,
  serviceIntervalMonths: null,
  serviceDays: null,
  motorised: true,
  assignedTo: null,
  value: 30000,
  purchasePrice: 0,
  purchaseDateDays: 0,
  lastServiceDays: null,
};

const READ_DOCKET = {
  ok: true,
  litres: 62.4,
  cost: 158.4,
  station: "Shell Coburg",
  date: "2026-08-31",
  gst: 14.4,
  abn: "51824753556",
};
const READ_INVOICE = {
  ok: true,
  workshop: "Braeside Auto",
  servicedOn: "2026-07-28",
  odometer: 120000,
  cost: 812.5,
  gst: 73.86,
  abn: "51824753556",
  summary: "120,000 km logbook service",
  workDone: ["Engine oil and filter", "Brake pads, front"],
};

function fleet(): FleetActions {
  return {
    pending: false,
    error: null,
    clearError: jest.fn(),
    saveVehicle: jest.fn(),
    recordRenewal: jest.fn(),
    attachPolicyDocument: jest.fn(),
    setVehiclePhoto: jest.fn(),
    recordFinance: jest.fn(),
    attachFinanceDocument: jest.fn(),
    attachPurchaseDocument: jest.fn(),
    removeVehicle: jest.fn(),
    assignVehicle: jest.fn(),
    addLog: jest.fn(async () => true),
    attachLogDocument: jest.fn(),
    editLog: jest.fn(),
    deleteLog: jest.fn(),
    resolveIssue: jest.fn(),
  };
}

function mount(screenName: "add:fuel" | "add:service" | "add:odo" | "add:issue") {
  const f = fleet();
  const onClose = jest.fn();
  render(
    <VehicleModal
      vehicle={triton}
      logs={[]}
      eco={{}}
      documents={[]}
      policies={[]}
      finance={[]}
      staff={[]}
      today={TODAY} warnDays={30}
      fleet={f}
      initialScreen={screenName}
      onClose={onClose}
      onEdit={jest.fn()}
      onCorrect={jest.fn()}
    />,
  );
  return { f, onClose, user: userEvent.setup() };
}

const logged = (f: FleetActions) => (f.addLog as jest.Mock).mock.calls[0][0] as NewLog;
const file = (name: string, type: string) => new File(["x"], name, { type });

beforeEach(() => {
  uploadFile.mockReset().mockResolvedValue({
    ok: true,
    file: { documentId: "doc-77", fileName: "receipt.jpg", mimeType: "image/jpeg", sizeBytes: 1, previewUrl: null },
  });
  readFuelReceipt.mockReset().mockResolvedValue(READ_DOCKET);
  readServiceRecord.mockReset().mockResolvedValue(READ_INVOICE);
});

describe("Log fuel", () => {
  it("scans the docket, fills the form, and hands Save the stored receipt, the tax figures and the docket's date", async () => {
    const { f, user } = mount("add:fuel");
    expect(screen.getByRole("heading", { name: "Log fuel" })).toBeInTheDocument();
    await user.upload(screen.getByLabelText("Scan document"), file("receipt.jpg", "image/jpeg"));
    await screen.findByText("Scanned");
    expect(uploadFile).toHaveBeenCalledWith(expect.anything(), "fuel_receipt");
    expect(screen.getByDisplayValue("62.4")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Shell Coburg")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Log fuel" }));
    expect(logged(f)).toMatchObject({
      vehicleId: "v1",
      kind: "fuel",
      litres: 62.4,
      cost: 158.4,
      station: "Shell Coburg",
      gst: 14.4,
      abn: "51824753556",
      purchasedOn: "2026-08-31",
      receiptDocumentId: "doc-77",
      source: "scan",
      paidWith: "company",
    });
    // and the card is back
    expect(screen.getByRole("heading", { name: "WORK TRITON" })).toBeInTheDocument();
  });

  it("keeps the docket and opens the fields empty when Tiff can't read it — nothing invented", async () => {
    readFuelReceipt.mockResolvedValue({ ok: false, reason: "no-key" });
    const { f, user } = mount("add:fuel");
    await user.upload(screen.getByLabelText("Scan document"), file("receipt.jpg", "image/jpeg"));
    await screen.findByText(/Tiff couldn't read that one/);
    expect(screen.queryByText(/Demo read/)).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Litres" }), "50");
    await user.click(screen.getByRole("button", { name: "Log fuel" }));
    expect(logged(f)).toMatchObject({ litres: 50, receiptDocumentId: "doc-77", source: "manual" });
  });

  it("my own money needs a cost, and says why, before Save is offered", async () => {
    const { f, user } = mount("add:fuel");
    await user.click(screen.getByText("Enter manually"));
    await user.type(screen.getByRole("textbox", { name: "Litres" }), "50");
    await user.click(screen.getByRole("tab", { name: "My own money" }));
    expect(screen.getByText(/Also claimed back to you/)).toBeInTheDocument();
    expect(screen.getByText(/Enter what it cost/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log fuel" })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Cost" }), "80");
    await user.click(screen.getByRole("button", { name: "Log fuel" }));
    expect(logged(f)).toMatchObject({ paidWith: "own", cost: 80, source: "manual" });
  });

  it("blocks a GST above an eleventh of the total", async () => {
    const { user } = mount("add:fuel");
    await user.upload(screen.getByLabelText("Scan document"), file("receipt.jpg", "image/jpeg"));
    await screen.findByText("Scanned");
    const gst = screen.getByRole("textbox", { name: "GST" });
    await user.clear(gst);
    await user.type(gst, "40");
    expect(screen.getByText(/more than an eleventh/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log fuel" })).toBeDisabled();
  });

  it("survives Escape and the backdrop while the docket is held; Cancel still leaves", async () => {
    const { user, onClose } = mount("add:fuel");
    await user.upload(screen.getByLabelText("Scan document"), file("receipt.jpg", "image/jpeg"));
    await screen.findByText("Scanned");
    await user.keyboard("{Escape}");
    fireEvent.click(document.querySelector(".vm-ov") as HTMLElement);
    expect(screen.getByRole("heading", { name: "Log fuel" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("heading", { name: "WORK TRITON" })).toBeInTheDocument();
  });
});

describe("Log service", () => {
  it("scans the invoice and hands Save the record, the work and the invoice's date", async () => {
    const { f, user } = mount("add:service");
    await user.upload(screen.getByLabelText("Scan document"), file("braeside-12041.pdf", "application/pdf"));
    await screen.findByText("Scanned");
    expect(uploadFile).toHaveBeenCalledWith(expect.anything(), "service_record");
    expect(screen.getByDisplayValue("Braeside Auto")).toBeInTheDocument();
    expect(screen.getByDisplayValue("120,000 km logbook service")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Log service" }));
    expect(logged(f)).toMatchObject({
      kind: "service",
      station: "Braeside Auto",
      odo: 120000,
      cost: 812.5,
      gst: 73.86,
      abn: "51824753556",
      note: "120,000 km logbook service",
      workDone: "Engine oil and filter\nBrake pads, front",
      purchasedOn: "2026-07-28",
      receiptDocumentId: "doc-77",
      source: "scan",
    });
  });

  it("stays put, typing intact, when the server refuses the entry", async () => {
    const { f, user } = mount("add:service");
    (f.addLog as jest.Mock).mockResolvedValue(false);
    await user.click(screen.getByText("Enter manually"));
    await user.type(screen.getByRole("textbox", { name: "Odometer at service (km)" }), "121000");
    await user.type(screen.getByRole("textbox", { name: "Workshop" }), "Braeside Auto");
    await user.click(screen.getByRole("button", { name: "Log service" }));
    await waitFor(() => expect(f.addLog).toHaveBeenCalled());
    expect(screen.getByRole("heading", { name: "Log service" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Braeside Auto")).toBeInTheDocument();
  });

  it("needs the odometer, and warns about a reading below the current one", async () => {
    const { user } = mount("add:service");
    await user.click(screen.getByText("Enter manually"));
    expect(screen.getByRole("button", { name: "Log service" })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Odometer at service (km)" }), "100000");
    expect(screen.getByText(/Lower than the current 108,375 km/)).toBeInTheDocument();
    // a warning, not a gate — the server refuses it; here it can still be corrected
    expect(screen.getByRole("button", { name: "Log service" })).toBeEnabled();
  });
});

describe("Update odometer and Report an issue", () => {
  it("a reading goes straight to the fields and to addLog", async () => {
    const { f, user } = mount("add:odo");
    await user.type(screen.getByRole("textbox", { name: "Odometer (km)" }), "109200");
    await user.click(screen.getByRole("button", { name: "Update odometer" }));
    expect(logged(f)).toEqual({ vehicleId: "v1", kind: "odo", odo: 109200 });
  });

  it("an issue needs its words, and carries nothing else", async () => {
    const { f, user } = mount("add:issue");
    expect(screen.getByRole("button", { name: "Report issue" })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "What's wrong" }), "Wiper blade split");
    await user.click(screen.getByRole("button", { name: "Report issue" }));
    expect(logged(f)).toEqual({ vehicleId: "v1", kind: "issue", note: "Wiper blade split" });
    await waitFor(() => expect(screen.getByRole("heading", { name: "WORK TRITON" })).toBeInTheDocument());
  });
});
