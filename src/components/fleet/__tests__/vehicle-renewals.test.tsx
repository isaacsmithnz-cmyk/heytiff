import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DetailModal, RenewalModal } from "../modals";
import { FleetRegister } from "../register";
import type { FleetState } from "../fleet-state";
import type { StoredDocument } from "@/lib/documents/query";
import type { Vehicle, VehiclePolicy } from "../logic";
import { vehicleChips } from "../logic";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

/* Renewals (issue #509, slice 2). Isaac's shape: near expiry an Update button
   appears, you drop the document in, it is scanned, the expiry updates and the
   previous one becomes history.

   Two things here are load-bearing and invisible if they break. The Update
   button must ride the SAME rule as the warning it answers — a button that
   appears on a different threshold than the chip is a button nobody finds when
   they need it. And "Current" must be DERIVED from the file list, because a
   stored flag is a second source of truth about which policy is in force. */

const uploadFile = jest.fn();
jest.mock("@/lib/documents/upload-client", () => ({
  uploadFile: (...a: unknown[]) => uploadFile(...a),
}));

const readRenewalDocument = jest.fn();
jest.mock("@/app/actions/fleet-ai", () => ({
  readFuelReceipt: jest.fn(async () => ({ ok: false, reason: "no-key" })),
  readPurchaseInvoice: jest.fn(async () => ({ ok: false, reason: "no-key" })),
  readRenewalDocument: (...a: unknown[]) => readRenewalDocument(...a),
}));

const TODAY = "2026-08-24";

const van: Vehicle = {
  id: "v1",
  name: "GOOD VAN",
  make: "Toyota",
  model: "Hiace",
  year: 2021,
  plate: "AAA111",
  plateState: "NSW",
  status: "active",
  odometer: 100000,
  regoDays: 200,
  insuranceDays: 200,
  serviceIntervalKm: 10000,
  lastServiceOdo: 95000,
  assignedTo: null,
  value: 30000,
  purchasePrice: 0,
  purchaseDateDays: 0,
};

function doc(over: Partial<StoredDocument>): StoredDocument {
  return {
    id: "d",
    kind: "insurance_policy",
    fileName: "policy.pdf",
    mimeType: "application/pdf",
    sizeBytes: 10,
    uploadedById: "s1",
    createdAt: "2026-08-01T00:00:00Z",
    url: "https://x/y",
    image: false,
    ...over,
  };
}

function detail(vehicle: Vehicle, extra: { documents?: StoredDocument[]; policies?: VehiclePolicy[] } = {}) {
  const onRenew = jest.fn();
  render(
    <DetailModal
      vehicle={vehicle}
      chips={vehicleChips(vehicle, 0)}
      logs={[]}
      eco={{}}
      documents={extra.documents ?? []}
      policies={extra.policies ?? []}
      onRenew={onRenew}
      staff={[]}
      manager
      onClose={jest.fn()}
      onEdit={jest.fn()}
      onAssign={jest.fn()}
      onStatus={jest.fn()}
      onLog={jest.fn()}
      onResolve={jest.fn()}
      onRemove={jest.fn()}
    />,
  );
  return { onRenew, user: userEvent.setup() };
}

beforeEach(() => {
  jest.clearAllMocks();
  uploadFile.mockResolvedValue({
    ok: true,
    file: { documentId: "doc-9", fileName: "policy.pdf", mimeType: "application/pdf", sizeBytes: 10, previewUrl: null },
  });
  readRenewalDocument.mockResolvedValue({
    ok: true,
    provider: "NRMA",
    premium: 1240.5,
    startsOn: "2026-09-01",
    expiresOn: "2027-09-01",
  });
});

it("shows no Update button while nothing is near expiry", () => {
  detail(van);
  expect(screen.queryByRole("button", { name: "Update" })).not.toBeInTheDocument();
});

it("offers Update on exactly the documents the chips are warning about", async () => {
  // insurance inside the warn window, rego comfortably clear
  const soon = { ...van, insuranceDays: 20, regoDays: 200 };
  expect(vehicleChips(soon, 0).some((c) => c.label.startsWith("Insurance"))).toBe(true);

  const { onRenew, user } = detail(soon);
  const buttons = screen.getAllByRole("button", { name: "Update" });
  expect(buttons).toHaveLength(1); // not on rego

  await user.click(buttons[0]);
  expect(onRenew).toHaveBeenCalledWith("insurance");
});

it("offers Update once a document has already expired", async () => {
  const { onRenew, user } = detail({ ...van, regoDays: -5 });
  await user.click(screen.getByRole("button", { name: "Update" }));
  expect(onRenew).toHaveBeenCalledWith("rego");
});

it("marks the newest of each kind current and the rest previous", () => {
  detail(van, {
    documents: [
      doc({ id: "new", fileName: "policy-2027.pdf", createdAt: "2026-08-20T00:00:00Z" }),
      doc({ id: "old", fileName: "policy-2026.pdf", createdAt: "2025-08-20T00:00:00Z" }),
      doc({ id: "rego", kind: "rego_notice", fileName: "rego.pdf", createdAt: "2026-01-01T00:00:00Z" }),
      doc({ id: "fuel", kind: "fuel_receipt", fileName: "docket.jpg", createdAt: "2026-08-22T00:00:00Z" }),
    ],
  });

  // one Current per renewal kind — insurance and rego — and no more
  expect(screen.getAllByText("Current")).toHaveLength(2);
  expect(screen.getAllByText("Previous")).toHaveLength(1);
  // a docket supersedes nothing, so it carries no tag at all
  const docket = screen.getByText("docket.jpg").closest("a")!;
  expect(docket.textContent).not.toMatch(/Current|Previous/);
});

it("lists what each renewal cost, and says nothing when the document didn't", () => {
  detail(van, {
    policies: [
      { id: "p1", kind: "insurance", provider: "NRMA", premium: 1240.5, startsOn: null, expiresOn: "2027-09-01", documentId: null },
      { id: "p2", kind: "insurance", provider: "AAMI", premium: null, startsOn: null, expiresOn: "2026-09-01", documentId: null },
    ],
  });
  expect(screen.getByText(/\$1,241/)).toBeInTheDocument();
  const aami = screen.getByText("AAMI").closest("div")!;
  expect(aami.textContent).not.toMatch(/\$/); // no premium invented
});

it("scans the dropped document into the fields, then saves what was confirmed", async () => {
  const onSave = jest.fn();
  render(<RenewalModal vehicle={van} kind="insurance" today={TODAY} onSave={onSave} onClose={jest.fn()} />);
  const user = userEvent.setup();

  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, new File(["x"], "policy.pdf", { type: "application/pdf" }));

  await waitFor(() => expect(screen.getByPlaceholderText("e.g. NRMA")).toHaveValue("NRMA"));
  expect(screen.getByLabelText(/^Expires/)).toHaveTextContent("01/09/2027");
  expect(uploadFile).toHaveBeenCalledWith(expect.anything(), "insurance_policy");

  await user.click(screen.getByRole("button", { name: /save insurance/i }));
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "insurance", expiresOn: "2027-09-01", premium: 1240.5, documentId: "doc-9" }),
  );
});

/* The modal tests above wire onRenew themselves, so they can never notice the
   register failing to render the RenewalModal at all — which is exactly what
   shipped: the renew case sat inside the "No vehicles yet" branch, so with any
   real fleet the Update click closed everything. This walks the actual path. */
it("Update opens the renewal flow from the real register, not just the empty state", async () => {
  const noop = jest.fn();
  const fleet: FleetState = {
    pending: false,
    error: null,
    clearError: noop,
    saveVehicle: noop,
    recordRenewal: noop,
    removeVehicle: noop,
    assignVehicle: noop,
    addLog: noop,
    editLog: noop,
    deleteLog: noop,
    resolveIssue: noop,
    vehicles: [{ ...van, regoDays: 20 }],
    logs: [],
    aiValues: {},
    documents: {},
    policies: {},
  };
  global.fetch = jest.fn(async () => ({ ok: false })) as unknown as typeof fetch;

  render(<FleetRegister fleet={fleet} staff={[]} today={TODAY} />);
  const user = userEvent.setup();

  await user.click(screen.getByText("GOOD VAN")); // the row opens the detail modal
  await user.click(screen.getByRole("button", { name: "Update" }));
  expect(screen.getByText("Update rego")).toBeInTheDocument();
});

it("cannot save without an expiry — the date is the thing that silences a warning", async () => {
  readRenewalDocument.mockResolvedValue({ ok: true, provider: "NRMA", premium: null, startsOn: null, expiresOn: null });
  const onSave = jest.fn();
  render(<RenewalModal vehicle={van} kind="rego" today={TODAY} onSave={onSave} onClose={jest.fn()} />);
  const user = userEvent.setup();

  expect(screen.getByRole("button", { name: /save rego/i })).toBeDisabled();
  await user.upload(
    document.querySelector('input[type="file"]') as HTMLInputElement,
    new File(["x"], "rego.pdf", { type: "application/pdf" }),
  );
  await waitFor(() => expect(screen.getByText(/couldn't find an expiry/i)).toBeInTheDocument());
  expect(screen.getByRole("button", { name: /save rego/i })).toBeDisabled();
  expect(onSave).not.toHaveBeenCalled();
});
