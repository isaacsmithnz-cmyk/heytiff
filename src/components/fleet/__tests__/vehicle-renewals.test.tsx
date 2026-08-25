import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DetailModal, RenewalHistoryModal, RenewalModal } from "../modals";
import { FleetRegister } from "../register";
import type { FleetState } from "../fleet-state";
import type { StoredDocument } from "@/lib/documents/query";
import type { Vehicle, VehiclePolicy } from "../logic";
import { currentRenewalDocIds, vehicleChips } from "../logic";

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
  const onHistory = jest.fn();
  render(
    <DetailModal
      vehicle={vehicle}
      chips={vehicleChips(vehicle, 0)}
      logs={[]}
      eco={{}}
      documents={extra.documents ?? []}
      policies={extra.policies ?? []}
      onRenew={onRenew}
      onHistory={onHistory}
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
  return { onRenew, onHistory, user: userEvent.setup() };
}

function policy(over: Partial<VehiclePolicy> = {}): VehiclePolicy {
  return {
    id: "p",
    kind: "insurance",
    provider: "NRMA",
    premium: 1240.5,
    startsOn: null,
    expiresOn: "2027-09-01",
    documentId: null,
    ...over,
  };
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

/* ---- the fact as a door: filing when nothing is warning ---- */

/* The gap this closes: Update only appears inside the 30-day window, so for
   most of the year — and for the whole back-catalogue — there was no way in. */
it("opens the history from a renewal fact that is nowhere near expiry", async () => {
  const { onHistory, user } = detail(van); // both dates 200 days out
  expect(screen.queryByRole("button", { name: "Update" })).not.toBeInTheDocument();

  await user.click(screen.getByText("Insurance"));
  expect(onHistory).toHaveBeenCalledWith("insurance");
});

it("does not turn the facts that own no paperwork into doors", async () => {
  const { onHistory, user } = detail(van);
  await user.click(screen.getByText("Odometer"));
  await user.click(screen.getByText("Next service"));
  expect(onHistory).not.toHaveBeenCalled();
});

it("lists what each renewal cost and covered, and offers Add renewal regardless of dates", async () => {
  const onAdd = jest.fn();
  render(
    <RenewalHistoryModal
      vehicle={van}
      kind="insurance"
      documents={[doc({ id: "d1", fileName: "policy-2027.pdf" })]}
      policies={[
        policy({ id: "p1", expiresOn: "2027-09-01", startsOn: "2026-09-01", documentId: "d1" }),
        policy({ id: "p2", provider: "AAMI", premium: null, expiresOn: "2026-09-01" }),
      ]}
      onAdd={onAdd}
      onClose={jest.fn()}
    />,
  );
  const user = userEvent.setup();

  expect(screen.getByText(/\$1,241/)).toBeInTheDocument();
  expect(screen.getByText("1 Sept 2026 – 1 Sept 2027")).toBeInTheDocument();
  expect(screen.getByText("policy-2027.pdf")).toBeInTheDocument();
  // the one with no printed premium invents none
  expect(screen.getByText("AAMI").closest(".fl-renrow")!.textContent).not.toMatch(/\$/);

  await user.click(screen.getByRole("button", { name: /add renewal/i }));
  expect(onAdd).toHaveBeenCalled();
});

it("shows a renewal kind with nothing filed as empty rather than missing", () => {
  render(
    <RenewalHistoryModal
      vehicle={van}
      kind="rego"
      documents={[doc({ id: "d1" })]} // an insurance policy — not this kind
      policies={[policy({ id: "p1", documentId: "d1" })]}
      onAdd={jest.fn()}
      onClose={jest.fn()}
    />,
  );
  expect(screen.getByText("Nothing on file yet")).toBeInTheDocument();
  expect(screen.queryByText("policy.pdf")).not.toBeInTheDocument();
});

/* ---- what back-filling breaks if "current" is read off the upload date ---- */

it("keeps Current on the policy in force when an older one is filed later", () => {
  // the 2024 policy is typed in TODAY, so it is the newest UPLOAD but the
  // oldest COVER — the vehicle's expiry stays on 2027 and so must this tag
  detail(van, {
    documents: [
      doc({ id: "backfilled", fileName: "policy-2024.pdf", createdAt: "2026-08-25T00:00:00Z" }),
      doc({ id: "live", fileName: "policy-2027.pdf", createdAt: "2026-08-01T00:00:00Z" }),
    ],
    policies: [
      policy({ id: "p1", expiresOn: "2027-09-01", documentId: "live" }),
      policy({ id: "p2", expiresOn: "2024-09-01", documentId: "backfilled" }),
    ],
  });

  const live = screen.getByText("policy-2027.pdf").closest("a")!;
  const old = screen.getByText("policy-2024.pdf").closest("a")!;
  expect(live.textContent).toMatch(/Current/);
  expect(old.textContent).toMatch(/Previous/);
});

it("reads current off the latest expiry however the rows arrive", () => {
  // same two policies, passed oldest-first — the answer must not move
  expect(
    currentRenewalDocIds(
      [
        policy({ expiresOn: "2024-09-01", documentId: "backfilled" }),
        policy({ expiresOn: "2027-09-01", documentId: "live" }),
      ],
      [],
    ),
  ).toEqual(new Set(["live"]));
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
