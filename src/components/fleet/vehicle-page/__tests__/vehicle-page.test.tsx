/* A VEHICLE'S OWN PAGE (v2, the boards v2-board-vehicle-*): the head, each
   section's rows, Add and Actions reaching today's screens and actions, the
   money shown only to the register, and the driver's own vehicle read-only
   where My vehicle is. Today's screens are stand-ins here that say which
   screen they were opened on; they have their own suites. */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FleetActions } from "../../fleet-state";
import type { Vehicle, VehicleLog, VehiclePolicy } from "../../logic";
import type { StoredDocument } from "@/lib/documents/query";
import type { VehiclePageData } from "@/lib/fleet/vehicle-page-data";
import { sectionsFor, type VehicleSection } from "@/lib/fleet/vehicle-page";

const push = jest.fn();
const replace = jest.fn();
const refresh = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, refresh }),
  usePathname: () => "/dashboard/vehicles/v1",
}));

const fleet: FleetActions = {
  pending: false,
  error: null,
  clearError: jest.fn(),
  saveVehicle: jest.fn(),
  recordRenewal: jest.fn(async () => true),
  attachPolicyDocument: jest.fn(),
  setVehiclePhoto: jest.fn(),
  recordFinance: jest.fn(async () => true),
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
jest.mock("../../fleet-state", () => ({ useFleetActions: () => fleet }));

const removeVehicle = jest.fn(async (_id: string) => ({ ok: true }) as { ok: true } | { ok: false; error: string });
jest.mock("@/app/actions/fleet", () => ({ removeVehicle: (id: string) => removeVehicle(id) }));
jest.mock("@/lib/documents/upload-client", () => ({ uploadFile: jest.fn(async () => ({ ok: false, error: "not in a test" })) }));

/* today's card, one screen at a time: says which, and offers Correct entry as the entry screen does */
jest.mock("../../vehicle-modal", () => {
  const derive = jest.requireActual("../../vehicle-modal/derive");
  return {
    addScreen: derive.addScreen,
    logScreen: derive.logScreen,
    VehicleModal: (p: { initialScreen: string; single?: boolean; logs: VehicleLog[]; onCorrect: (l: VehicleLog) => void; onClose: () => void }) => (
      <div role="dialog" aria-label="Today's screen">
        <p>{`Screen ${p.initialScreen}${p.single ? ", alone" : ""}`}</p>
        <button type="button" onClick={() => p.onCorrect(p.logs.find((l) => `log:${l.id}` === p.initialScreen)!)}>
          Correct entry
        </button>
        <button type="button" onClick={p.onClose}>
          Back
        </button>
      </div>
    ),
  };
});
jest.mock("../../vehicle-modal/vehicle-form", () => ({
  VehicleForm: (p: { initial: Vehicle }) => <p>{`Today's vehicle form for ${p.initial.name}`}</p>,
}));
jest.mock("../../modals", () => ({
  EditLogModal: (p: { log: VehicleLog; onSave: (x: object) => void }) => (
    <div role="dialog" aria-label="Correction">
      <p>{`Correcting ${p.log.id}`}</p>
      <button type="button" onClick={() => p.onSave({ note: "fixed" })}>
        Save correction
      </button>
    </div>
  ),
  LogModal: (p: { kind: string; vehicle: { id: string } }) => <p>{`Today's log dialog: ${p.kind} on ${p.vehicle.id}`}</p>,
}));

import { VehiclePage } from "../vehicle-page";
import { pageNamesSnapshot } from "@/components/shell/page-names";

const TODAY = "2026-10-18";

const hilux: Vehicle = {
  id: "v1",
  name: "Hilux",
  make: "Toyota",
  model: "Hilux SR5",
  year: 2021,
  plate: "XQG41B",
  plateState: "NSW",
  status: "active",
  odometer: 128400,
  regoDays: 25,
  insuranceDays: 140,
  ctpDays: 25,
  serviceIntervalKm: 10000,
  lastServiceOdo: 120200,
  serviceIntervalMonths: 6,
  serviceDays: 73,
  motorised: true,
  assignedTo: "s-lyle",
  value: 41000,
  purchasePrice: 58990,
  purchaseDateDays: 900,
  lastServiceDays: 110,
  vin: "MR0HA3CD300812345",
  purchaseSupplier: "Botany Toyota",
};

const log = (over: Partial<VehicleLog> & Pick<VehicleLog, "id" | "kind" | "ago">): VehicleLog => ({
  vehicleId: "v1",
  staffId: "s-lyle",
  staffName: "Lyle Irving",
  when: `day ${over.ago}`,
  ...over,
});

const LOGS: VehicleLog[] = [
  log({ id: "f1", kind: "fuel", ago: 2, litres: 68.2, cost: 141.2, odo: 128400, station: "Ampol Botany", paidWith: "company", hasReceipt: true }),
  log({ id: "i1", kind: "issue", ago: 3, note: "Aircon blowing warm", odo: 128210, status: "open" }),
  log({ id: "o1", kind: "odo", ago: 20, odo: 127100 }),
  log({ id: "i0", kind: "issue", ago: 47, note: "Rear left tyre slow leak", status: "resolved", staffId: "s-dan", staffName: "Dan Walsh" }),
  log({ id: "s1", kind: "service", ago: 110, note: "Logbook service, 120,000 km", odo: 120200, station: "Botany Toyota", cost: 486, staffId: "s-isaac", staffName: "Isaac Smith" }),
  log({ id: "s0", kind: "service", ago: 289, note: "Logbook service, 110,000 km", odo: 110150, station: "Botany Toyota", cost: 412, staffId: "s-isaac", staffName: "Isaac Smith" }),
];

const POLICIES: VehiclePolicy[] = [
  { id: "r1", kind: "rego", provider: "Transport for NSW", premium: null, startsOn: null, expiresOn: "2026-11-12", documentId: null, createdAt: "2025-11-01T00:00:00Z" },
  { id: "p1", kind: "insurance", provider: "NRMA", premium: 2140, startsOn: "2026-03-07", expiresOn: "2027-03-07", documentId: null, cover: "comprehensive", createdAt: "2026-03-01T00:00:00Z" },
];

const doc = (id: string, over: Partial<StoredDocument>): StoredDocument => ({
  id,
  kind: "service_record",
  fileName: `${id}.pdf`,
  mimeType: "application/pdf",
  sizeBytes: 1000,
  uploadedById: null,
  createdAt: "2026-06-30T00:00:00Z",
  url: `https://signed.example/${id}`,
  image: false,
  policyId: null,
  financeId: null,
  credentialRecordId: null,
  licenceRecordId: null,
  workRightsRecordId: null,
  vehicleLogId: null,
  ...over,
});

const managerData = (): VehiclePageData => ({
  lens: "register",
  vehicle: hilux,
  logs: LOGS,
  documents: [
    doc("d-s1", { vehicleLogId: "s1" }),
    doc("d-rego", { kind: "rego_notice", policyId: "r1", fileName: "rego.pdf" }),
    doc("d-ins", { kind: "insurance_policy", policyId: "p1", fileName: "nrma.pdf" }),
  ],
  policies: POLICIES,
  finance: [],
  valuation: { point: 39500, low: 37000, high: 42000, note: "Dealer listings", atOdo: 128000 },
  staff: [
    { id: "s-lyle", name: "Lyle Irving", status: "Active" },
    { id: "s-dan", name: "Dan Walsh", status: "Active" },
  ],
  today: TODAY,
  warnDays: 30,
  viewerStaffId: "s-isaac",
});

const driverData = (over: Partial<Vehicle> = {}): VehiclePageData => {
  /* own-vehicle width: the facts and nothing of the register's */
  const { assignedTo: _a, value: _v, purchasePrice: _p, purchaseDateDays: _d, lastServiceDays: _l, vin: _vin, purchaseSupplier: _s, ...facts } = { ...hilux, ...over };
  return {
    lens: "driver",
    vehicle: facts,
    logs: LOGS,
    pickable: [
      { id: "v1", name: "Hilux", make: "Toyota", model: "Hilux SR5", year: 2021, plate: "XQG41B", plateState: "NSW", status: facts.status, odometer: 128400 },
      { id: "v2", name: "Pool ute", make: "Ford", model: "Ranger", year: 2020, plate: "POOL01", plateState: "NSW", status: "active", odometer: 90000 },
    ],
    today: TODAY,
    warnDays: 30,
    viewerStaffId: "s-lyle",
  };
};

const draw = (data: VehiclePageData, section: VehicleSection = "overview") =>
  render(<VehiclePage data={data} sections={sectionsFor({ register: data.lens === "register", motorised: data.vehicle.motorised })} section={section} />);

const user = () => userEvent.setup();
const tab = (name: RegExp) => screen.getByRole("tab", { name });
const opened = () => screen.queryByRole("dialog", { name: "Today's screen" });

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, "", "/dashboard/vehicles/v1");
});

describe("the head", () => {
  it("names the vehicle and its rego, one grey line, and its state as a word", () => {
    draw(managerData());
    expect(screen.getByRole("heading", { level: 1, name: "Hilux XQG41B" })).toBeInTheDocument();
    expect(screen.getByText("Lyle Irving, 128,400 km, Toyota Hilux SR5 2021.")).toBeInTheDocument();
    const word = screen.getByText("Rego due in 25 days");
    expect(word.closest(".pt-state")).toHaveClass("pt-state--look");
  });

  it("names its open tab with the truck", () => {
    draw(managerData());
    expect(pageNamesSnapshot()["/dashboard/vehicles/v1"]).toEqual({ label: "Hilux XQG41B", icon: "truck" });
  });

  it("keeps the section in the address as ?tab=", async () => {
    draw(managerData());
    await user().click(tab(/^Service/));
    expect(window.location.search).toBe("?tab=service");
    await user().click(tab(/^Overview/));
    expect(window.location.search).toBe("");
  });
});

it("says an overdue rego in red in the head", () => {
  const data = managerData();
  draw({ ...data, vehicle: { ...hilux, regoDays: -3 } } as VehiclePageData);
  expect(screen.getByText("Rego 3 days overdue").closest(".pt-state")).toHaveClass("pt-state--wrong");
});

describe("the sections", () => {
  it("Overview: the latest of each kind, where it stands, and the details", () => {
    draw(managerData());
    const latest = screen.getByRole("list", { name: "The latest of each kind" });
    expect(within(latest).getByText("Aircon blowing warm")).toBeInTheDocument();
    expect(within(latest).getByText("68.2 litres, $141.20")).toBeInTheDocument();
    expect(within(latest).getByText("Insurance renewed to 7 Mar 2027")).toBeInTheDocument();
    expect(within(latest).getByText("Receipt kept")).toBeInTheDocument();
    expect(within(latest).getByText("Policy kept")).toBeInTheDocument();
    expect(screen.getAllByText("Due in 25 days")).toHaveLength(2); // rego and green slip
    expect(screen.getByRole("button", { name: "Renew rego" })).toHaveClass("pt-btn--main");
    expect(screen.getByText("MR0HA3CD300812345")).toBeInTheDocument();
    expect(screen.getByText("Book value; Tiff puts it near $39,500")).toBeInTheDocument();
  });

  it("Service: the history with its paper, the next one due and the year's spend", async () => {
    draw(managerData(), "service");
    expect(tab(/^Service/)).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "At 130,200 km or by 30 Dec 2026" })).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Logbook service, 120,000 km")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Record kept")).toBeInTheDocument();
    expect(within(rows[1]).getByRole("button", { name: "Attach record" })).toBeInTheDocument();
    expect(screen.getByText("$898.00 on service in the last 12 months.")).toBeInTheDocument();
    await user().click(within(rows[1]).getByRole("button", { name: "Attach record" }));
    expect(screen.getByText("Screen log:s0, alone")).toBeInTheDocument();
  });

  it("Issues: open first, then fixed; an issue opens today's entry screen, where Mark resolved is", async () => {
    draw(managerData(), "issues");
    const open = screen.getByRole("list", { name: "Open issues" });
    expect(within(open).getByText("Aircon blowing warm")).toBeInTheDocument();
    expect(within(open).getByText("Open")).toBeInTheDocument();
    const fixed = screen.getByRole("list", { name: "Fixed issues" });
    expect(within(fixed).getByText("Rear left tyre slow leak")).toBeInTheDocument();
    await user().click(within(open).getByRole("button", { name: "Aircon blowing warm" }));
    expect(screen.getByText("Screen log:i1, alone")).toBeInTheDocument();
  });

  it("Kilometres: the line and the readings, newest first", () => {
    draw(managerData(), "kilometres");
    expect(screen.getByRole("img", { name: /The odometer over the last 12 months/ })).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[1].textContent)).toEqual(["128,400 km", "128,210 km", "127,100 km", "120,200 km", "110,150 km"]);
    expect(within(rows[0]).getByText("Fuel docket, Ampol Botany")).toBeInTheDocument();
    expect(within(rows[0]).getByText("+190")).toBeInTheDocument();
  });

  it("Fuel: the fills", () => {
    draw(managerData(), "fuel");
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText("Ampol Botany")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Company card")).toBeInTheDocument();
  });

  it("Documents: the renewals and the stored scans", async () => {
    draw(managerData(), "documents");
    const renewals = screen.getByRole("list", { name: "Renewals" });
    expect(within(renewals).getByText("Rego to 12 Nov 2026")).toBeInTheDocument();
    const scans = screen.getByRole("list", { name: "Stored scans" });
    expect(within(scans).getByText("Rego notice")).toBeInTheDocument();
    expect(within(scans).getAllByRole("link", { name: "Open the file" })[0]).toHaveAttribute("href", expect.stringContaining("signed.example"));
    await user().click(within(renewals).getByRole("button", { name: "Insurance to 7 Mar 2027" }));
    expect(screen.getByText("Screen insurance, alone")).toBeInTheDocument();
  });

  it("Money: today's financials screen's content, and its door for the edits", async () => {
    draw(managerData(), "money");
    expect(screen.getByText("$39,500")).toBeInTheDocument();
    expect(screen.getByText("Botany Toyota")).toBeInTheDocument();
    expect(screen.getByText("No finance agreement recorded.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Value with Tiff" })).toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: "Edit the money" }));
    expect(screen.getByText("Screen financials, alone")).toBeInTheDocument();
  });
});

describe("Add", () => {
  const pick = async (...names: string[]) => {
    const u = user();
    await u.click(screen.getByRole("button", { name: /^Add/ }));
    for (const n of names) await u.click(screen.getByRole("menuitem", { name: new RegExp(`^${n}`) }));
  };

  it("opens today's logging screens for a service, an issue and a reading", async () => {
    draw(managerData());
    await pick("Service");
    expect(screen.getByText("Screen add:service, alone")).toBeInTheDocument();
    await user().click(within(opened()!).getByRole("button", { name: "Back" }));
    expect(opened()).toBeNull();
    await pick("Issue");
    expect(screen.getByText("Screen add:issue, alone")).toBeInTheDocument();
    await user().click(within(opened()!).getByRole("button", { name: "Back" }));
    await pick("Kilometres");
    expect(screen.getByText("Screen add:odo, alone")).toBeInTheDocument();
  });

  it("files a document through today's renewal and financials screens", async () => {
    draw(managerData());
    await pick("Document", "Rego notice");
    expect(screen.getByText("Screen rego, alone")).toBeInTheDocument();
    await user().click(within(opened()!).getByRole("button", { name: "Back" }));
    await pick("Document", "Purchase invoice");
    expect(screen.getByText("Screen financials, alone")).toBeInTheDocument();
  });

  it("pauses a reading on a vehicle off the road, as the server does", async () => {
    draw({ ...managerData(), vehicle: { ...hilux, status: "offroad" } } as VehiclePageData);
    await user().click(screen.getByRole("button", { name: /^Add/ }));
    expect(screen.getByRole("menuitem", { name: /^Kilometres/ })).toHaveAttribute("aria-disabled", "true");
  });

  it("Renew rego and Edit details open today's renewal screen and form", async () => {
    draw(managerData());
    await user().click(screen.getByRole("button", { name: "Renew slip" }));
    expect(screen.getByText("Screen ctp, alone")).toBeInTheDocument();
    await user().click(within(opened()!).getByRole("button", { name: "Back" }));
    await user().click(screen.getByRole("button", { name: "Edit details" }));
    expect(screen.getByText("Today's vehicle form for Hilux")).toBeInTheDocument();
  });

  it("Correct entry opens today's correction over the entry, and returns to it", async () => {
    draw(managerData(), "issues");
    await user().click(screen.getByRole("button", { name: "Aircon blowing warm" }));
    await user().click(screen.getByRole("button", { name: "Correct entry" }));
    expect(screen.getByText("Correcting i1")).toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: "Save correction" }));
    expect(fleet.editLog).toHaveBeenCalledWith("i1", { note: "fixed" });
    expect(screen.getByText("Screen log:i1, alone")).toBeInTheDocument();
  });
});

describe("Actions", () => {
  it("changes the status through today's save", async () => {
    draw(managerData());
    const u = user();
    await u.click(screen.getByRole("button", { name: /^Actions/ }));
    await u.click(screen.getByRole("menuitem", { name: "Change status" }));
    await u.click(screen.getByRole("option", { name: "Off road" }));
    expect(fleet.saveVehicle).toHaveBeenCalledWith(expect.objectContaining({ id: "v1", status: "offroad" }));
  });

  it("puts Remove vehicle last, in red, and asks before it removes", async () => {
    draw(managerData());
    const u = user();
    await u.click(screen.getByRole("button", { name: /^Actions/ }));
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Change status", "Change photo", "Remove vehicle"]);
    await u.click(items[2]);
    expect(removeVehicle).not.toHaveBeenCalled();
    const ask = screen.getByRole("dialog", { name: "Remove Hilux XQG41B?" });
    await u.click(within(ask).getByRole("button", { name: "Remove vehicle" }));
    expect(removeVehicle).toHaveBeenCalledWith("v1");
    expect(replace).toHaveBeenCalledWith("/dashboard/assets");
  });

  it("says why when the removal is refused, and stays", async () => {
    removeVehicle.mockResolvedValueOnce({ ok: false, error: "Couldn't remove that vehicle." });
    draw(managerData());
    const u = user();
    await u.click(screen.getByRole("button", { name: /^Actions/ }));
    await u.click(screen.getByRole("menuitem", { name: "Remove vehicle" }));
    await u.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove vehicle" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't remove that vehicle.");
    expect(replace).not.toHaveBeenCalled();
  });

  it("changes the driver through today's assignment", async () => {
    draw(managerData());
    const u = user();
    await u.click(screen.getByRole("button", { name: "Change driver" }));
    await u.click(screen.getByRole("option", { name: "Dan Walsh" }));
    expect(fleet.assignVehicle).toHaveBeenCalledWith("v1", "s-dan");
  });
});

describe("the money gate", () => {
  it("shows Money, Documents and the value to the register", () => {
    draw(managerData());
    expect(tab(/^Money/)).toBeInTheDocument();
    expect(tab(/^Documents/)).toBeInTheDocument();
    expect(screen.getByText("Value")).toBeInTheDocument();
  });

  it("shows a driver no Money, no Documents and no value", () => {
    draw(driverData());
    expect(screen.queryByRole("tab", { name: /^Money/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /^Documents/ })).toBeNull();
    expect(screen.queryByText("Value")).toBeNull();
    expect(screen.queryByText(/Tiff puts it/)).toBeNull();
  });
});

describe("a driver's own vehicle, read-only where My vehicle is", () => {
  it("has no Actions, no renewals and no assigning", () => {
    draw(driverData());
    expect(screen.queryByRole("button", { name: /^Actions/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Renew rego" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change driver" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit details" })).toBeNull();
    expect(screen.getByText("You")).toBeInTheDocument();
  });

  it("adds an issue or a reading through My vehicle's own dialog, and no service", async () => {
    draw(driverData());
    const u = user();
    await u.click(screen.getByRole("button", { name: /^Add/ }));
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Issue", "Kilometres"]);
    await u.click(screen.getByRole("menuitem", { name: "Kilometres" }));
    expect(screen.getByText("Today's log dialog: odo on v1")).toBeInTheDocument();
  });

  it("logs fuel on a pool ute while their own is off the road, as My vehicle offers", async () => {
    draw(driverData({ status: "offroad" }), "fuel");
    await user().click(screen.getByRole("button", { name: "Log fuel" }));
    expect(screen.getByText("Today's log dialog: fuel on v2")).toBeInTheDocument();
  });

  it("corrects their own entries and opens nobody else's", async () => {
    draw(driverData(), "issues");
    await user().click(screen.getByRole("button", { name: "Aircon blowing warm" }));
    expect(screen.getByText("Correcting i1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rear left tyre slow leak" })).toBeNull();
  });
});
