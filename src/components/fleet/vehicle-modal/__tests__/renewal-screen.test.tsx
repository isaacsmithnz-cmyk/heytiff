import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StoredDocument } from "@/lib/documents/query";
import type { Vehicle, VehiclePolicy } from "../../logic";
import { RenewalScreen } from "../renewal-screen";

/* The renewal screen against the Triton's real paperwork: a QBE green slip
   filed under CTP, and the same screen asked to be Registration and Insurance.

   The scan is the REAL flow — upload and read in parallel, fields filled from
   the read, nothing saved until Save — with both halves mocked at the module
   boundary the way every fleet test does. */

const uploadFile = jest.fn();
jest.mock("@/lib/documents/upload-client", () => ({
  uploadFile: (...a: unknown[]) => uploadFile(...a),
}));

const readRenewalDocument = jest.fn();
jest.mock("@/app/actions/fleet-ai", () => ({
  readRenewalDocument: (...a: unknown[]) => readRenewalDocument(...a),
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
  regoDays: 392,
  insuranceDays: null,
  ctpDays: 392,
  serviceIntervalKm: 10000,
  lastServiceOdo: 108375,
  serviceIntervalMonths: null,
  serviceDays: null,
  motorised: true,
  assignedTo: null,
  value: 30000,
  purchasePrice: 0,
  purchaseDateDays: 0,
  lastServiceDays: null,
  gvmKg: 2900,
};

const greenSlip: VehiclePolicy = {
  id: "p-ctp",
  kind: "ctp",
  provider: "QBE",
  premium: 945.54,
  startsOn: "2026-09-30",
  expiresOn: "2027-09-29",
  documentId: "d-slip",
  policyNumber: "36-01023321955",
  garagingPostcode: "2031",
  termMonths: 12,
  source: "scan",
  createdAt: "2026-08-30T00:00:00Z",
};

const rego: VehiclePolicy = {
  id: "p-rego",
  kind: "rego",
  provider: "Transport for NSW",
  premium: 1008,
  startsOn: "2026-09-30",
  expiresOn: "2027-09-29",
  documentId: null,
  termMonths: 12,
  source: "manual",
};

const slipDoc: StoredDocument = {
  id: "d-slip",
  kind: "green_slip",
  fileName: "greenslip.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 1891453,
  uploadedById: "s1",
  createdAt: "2026-08-30T00:00:00Z",
  url: "https://signed/slip.jpg",
  image: true,
  policyId: "p-ctp",
  financeId: null,
};

function mount(kind: "rego" | "insurance" | "ctp", over: { vehicle?: Vehicle; policies?: VehiclePolicy[]; documents?: StoredDocument[] } = {}) {
  const onSave = jest.fn();
  const onAttach = jest.fn();
  const onBack = jest.fn();
  render(
    <RenewalScreen
      vehicle={over.vehicle ?? triton}
      kind={kind}
      today={TODAY}
      documents={over.documents ?? [slipDoc]}
      policies={over.policies ?? [greenSlip, rego]}
      reminders={[]}
      onRemind={jest.fn()}
      pending={false}
      error={null}
      onBack={onBack}
      onSave={onSave}
      onAttach={onAttach}
    />,
  );
  return { onSave, onAttach, onBack, user: userEvent.setup() };
}

beforeEach(() => {
  jest.clearAllMocks();
  uploadFile.mockResolvedValue({
    ok: true,
    file: { documentId: "doc-9", fileName: "slip.jpg", mimeType: "image/jpeg", sizeBytes: 10, previewUrl: null },
  });
  readRenewalDocument.mockResolvedValue({
    ok: true,
    provider: "QBE",
    premium: 945.54,
    startsOn: "2026-09-30",
    expiresOn: "2027-09-29",
    policyNumber: "36-01023321955",
    cover: null,
    excess: null,
    termMonths: 12,
    garagingPostcode: "2031",
    inspectionOn: null,
  });
});

describe("green slip", () => {
  it("shows the record in force: covered, by whom, until when, with its paper", () => {
    mount("ctp");
    expect(screen.getByRole("heading", { name: "Green slip (CTP)" })).toBeInTheDocument();
    expect(screen.getByText("Covered")).toBeInTheDocument();
    expect(screen.getByText("CTP · QBE · expires 29 Sep 2027")).toBeInTheDocument();
    expect(screen.getByText("36-01023321955")).toBeInTheDocument();
    expect(screen.getByText("2031")).toBeInTheDocument();
    // the class comes from the GVM on the certificate, not from the icon
    expect(screen.getByText("Goods vehicle ≤4.5t")).toBeInTheDocument();
    expect(screen.getByText("Yes · same expiry")).toBeInTheDocument();
    expect(screen.getByText("Added 30 Aug 2026 · scanned from the document")).toBeInTheDocument();
    expect(screen.getByText("greenslip.jpg · 1.8 MB")).toBeInTheDocument();
    // a record exists, so the panel waits behind its button
    expect(screen.getByRole("button", { name: "Update green slip" })).toBeInTheDocument();
    expect(screen.queryByText("Scan or upload the green slip")).not.toBeInTheDocument();
  });

  it("opens a document inline from its row, one at a time", async () => {
    const { user } = mount("ctp");
    await user.click(screen.getByRole("button", { name: /Green slip greenslip\.jpg/ }));
    expect(screen.getByAltText("greenslip.jpg")).toHaveAttribute("src", "https://signed/slip.jpg");
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute("href", "https://signed/slip.jpg");
    await user.click(screen.getByRole("button", { name: "Close preview" }));
    expect(screen.queryByAltText("greenslip.jpg")).not.toBeInTheDocument();
  });

  it("scans the next slip into the fields and saves what was confirmed, as a scan", async () => {
    const { user, onSave } = mount("ctp");
    await user.click(screen.getByRole("button", { name: "Update green slip" }));
    await user.upload(screen.getByLabelText("Scan document"), new File(["x"], "slip-2027.jpg", { type: "image/jpeg" }));

    await waitFor(() => expect(screen.getByText("Details read from document — check before saving")).toBeInTheDocument());
    expect(screen.getByText("slip-2027.jpg")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. QBE")).toHaveValue("QBE");
    expect(screen.getByLabelText("Expires")).toHaveTextContent("29/09/2027");
    expect(readRenewalDocument).toHaveBeenCalledWith(expect.any(String), expect.any(String), "ctp");
    expect(uploadFile).toHaveBeenCalledWith(expect.anything(), "green_slip");

    await user.click(screen.getByRole("button", { name: "Save green slip" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "ctp",
        provider: "QBE",
        premium: 945.54,
        startsOn: "2026-09-30",
        expiresOn: "2027-09-29",
        policyNumber: "36-01023321955",
        garagingPostcode: "2031",
        termMonths: 12,
        documentId: "doc-9",
        source: "scan",
      }),
    );
  });

  it("still files the document when Tiff can't read it, and says so", async () => {
    readRenewalDocument.mockResolvedValue({ ok: false, reason: "no-key" });
    const { user } = mount("ctp");
    await user.click(screen.getByRole("button", { name: "Update green slip" }));
    await user.upload(screen.getByLabelText("Scan document"), new File(["x"], "slip.jpg", { type: "image/jpeg" }));
    await waitFor(() => expect(screen.getByText("Tiff couldn't read that one — enter the details below.")).toBeInTheDocument());
    // manual mode, with the upload already attached
    expect(screen.getByText("Attached: slip.jpg")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. QBE")).toHaveValue("");
  });

  it("files another piece of paper under the record in force", async () => {
    const { user, onAttach } = mount("ctp");
    await user.upload(screen.getByLabelText("Add document"), new File(["x"], "receipt.pdf", { type: "application/pdf" }));
    await waitFor(() => expect(onAttach).toHaveBeenCalledWith("p-ctp", "doc-9"));
    expect(uploadFile).toHaveBeenCalledWith(expect.anything(), "green_slip");
  });

  it("lists previous slips as history and opens one to its detail", async () => {
    const older: VehiclePolicy = { ...greenSlip, id: "p-old", provider: "NRMA", premium: 612, expiresOn: "2026-09-29", documentId: null, policyNumber: "CTP-2209" };
    const { user } = mount("ctp", { policies: [greenSlip, rego, older] });
    const row = screen.getByRole("button", { name: /CTP · NRMA/ });
    expect(row).toHaveTextContent("$612");
    expect(row).toHaveTextContent("29 Sep 2026");
    await user.click(row);
    expect(screen.getByText("CTP-2209")).toBeInTheDocument();
    expect(screen.getByText("No paperwork filed.")).toBeInTheDocument();
  });
});

describe("registration", () => {
  it("keeps the record panel open — a rego is renewed every year — and fills from the notice", async () => {
    const { user, onSave } = mount("rego");
    expect(screen.getByText("Renews in 13 months")).toBeInTheDocument();
    expect(screen.getByText("Expires 29 Sep 2027")).toBeInTheDocument();
    expect(screen.getByText("Scan or upload the renewal notice")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeInTheDocument(); // the footer's, not the panel's
    // safety check: not recorded is said, not blanked
    expect(screen.getByText("Not recorded")).toBeInTheDocument();

    readRenewalDocument.mockResolvedValue({
      ok: true,
      provider: "Transport for NSW",
      premium: 1008,
      startsOn: "2027-09-30",
      expiresOn: "2028-09-29",
      policyNumber: null,
      cover: null,
      excess: null,
      termMonths: 12,
      garagingPostcode: null,
      inspectionOn: "2027-08-30",
    });
    await user.upload(screen.getByLabelText("Scan document"), new File(["x"], "rego-2027.pdf", { type: "application/pdf" }));
    await waitFor(() => expect(screen.getByLabelText("Expires")).toHaveTextContent("29/09/2028"));
    expect(screen.getByLabelText("Safety check")).toHaveTextContent("30/08/2027");

    await user.click(screen.getByRole("button", { name: "Save renewal" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "rego", expiresOn: "2028-09-29", inspectionOn: "2027-08-30", premium: 1008, cover: null, garagingPostcode: null }),
    );
  });
});

describe("insurance with nothing on file", () => {
  it("says so, forces the panel open, and lets the policy be typed", async () => {
    const { user, onSave } = mount("insurance", { policies: [greenSlip, rego] });
    expect(screen.getByText("No policy recorded")).toBeInTheDocument();
    expect(screen.getByText("Scan or upload the certificate of insurance")).toBeInTheDocument();
    // no record to fall back to, so the panel has no Cancel of its own
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1);

    await user.click(screen.getByText("Enter manually"));
    await user.type(screen.getByPlaceholderText("e.g. NRMA"), "NRMA");
    await user.selectOptions(screen.getByRole("combobox", { name: /cover/i }), "comprehensive");
    // no expiry yet: nothing to save
    expect(screen.getByRole("button", { name: "Save policy" })).toBeDisabled();

    await user.click(screen.getByLabelText("Expires"));
    await user.click(screen.getByRole("button", { name: "Tuesday 29 September 2026" }));
    await user.click(screen.getByRole("button", { name: "Save policy" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "insurance", provider: "NRMA", cover: "comprehensive", expiresOn: "2026-09-29", source: "manual" }),
    );
  });

  it("scopes the fields to the kind: cover and excess for insurance, nothing of the green slip's", async () => {
    const { user } = mount("insurance", { policies: [] });
    await user.click(screen.getByText("Enter manually"));
    expect(screen.getByRole("combobox", { name: /cover/i })).toBeInTheDocument();
    expect(screen.getByText("Excess")).toBeInTheDocument();
    expect(screen.queryByText("Garaging postcode")).not.toBeInTheDocument();
    expect(screen.queryByText("Safety check")).not.toBeInTheDocument();
    const grid = screen.getByText("Excess").closest(".vm-fields") as HTMLElement;
    expect(within(grid).queryByText("Term")).not.toBeInTheDocument();
  });
});
