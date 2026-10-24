/* A VEHICLE'S OWN PAGE (v2; each fact once, Isaac's mock of 24 October
   2026): the head (the make and model, the plate beside it, one grey line),
   each section's rows, Add and Actions reaching today's screens and
   actions, the money shown only to the register, and the driver's own
   vehicle read-only where My vehicle is. Today's screens are stand-ins here
   that say which screen they were opened on; they have their own suites. */

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
  VehicleForm: (p: { initial: Vehicle }) => <p>{`The vehicle form, filled in for ${p.initial.name}`}</p>,
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

const hiace = (): VehiclePageData => {
  const vehicle: Vehicle = { ...hilux, name: "Zucky", make: "Toyota", model: "Hiace", year: 2022, plate: "EVD72G", plateState: "NSW", assignedTo: "s-dan" };
  return { ...managerData(), vehicle } as VehiclePageData;
};

describe("the head", () => {
  it("is the make and model, with the plate drawn beside it as a NSW plate (Isaac: \"At the top, Toyota Hiace\")", () => {
    const { container } = draw(hiace());
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent(/^Toyota Hiace$/);
    const plate = container.querySelector(".vp-title .au-plate.xl")!;
    expect(plate).not.toBeNull();
    expect(plate.parentElement).toBe(h1.parentElement);
    expect([...plate.children].map((c) => c.textContent)).toEqual(["NSW", "EVD72G"]);
    /* the nickname and the plate no longer lead the title */
    expect(h1).not.toHaveTextContent(/Zucky|EVD72G/);
  });

  it("says the year, the nickname, who drives it and its status on one grey line", () => {
    draw(hiace());
    expect(screen.getByText("2022, Zucky, Dan Walsh drives it.")).toBeInTheDocument();
    const status = screen.getByText("In service");
    expect(status.closest(".pt-state")).toHaveClass("pt-state--good");
    expect(status.closest(".vp-line")).not.toBeNull();
  });

  it("says No driver for the pool", () => {
    draw({ ...managerData(), vehicle: { ...hilux, assignedTo: null } } as VehiclePageData);
    expect(screen.getByText("2021, Hilux, No driver.")).toBeInTheDocument();
  });

  it("names its open tab with the title and plate, and the truck", () => {
    draw(managerData());
    expect(pageNamesSnapshot()["/dashboard/vehicles/v1"]).toEqual({ label: "Toyota Hilux SR5 XQG41B", icon: "truck" });
  });

  it("keeps the section in the address as ?tab=", async () => {
    draw(managerData());
    await user().click(tab(/^Service/));
    expect(window.location.search).toBe("?tab=service");
    await user().click(tab(/^Overview/));
    expect(window.location.search).toBe("");
  });

  it("has the six sections, with no Kilometres tab", () => {
    draw(managerData());
    expect(screen.getAllByRole("tab").map((t) => t.textContent?.replace(/, something to look at$/, ""))).toEqual(["Overview", "Service", "Fuel", "Issues", "Documents", "Money"]);
  });

  it("opens the photo picker from the photo square, which says Add a photo until there is one", async () => {
    draw(managerData());
    const picker = screen.getByLabelText("Change photo") as HTMLInputElement;
    const click = jest.spyOn(picker, "click").mockImplementation(() => {});
    await user().click(screen.getByRole("button", { name: "Add a photo" }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("paints no button ink, and blue only for the one main button", () => {
    const overview = draw(managerData());
    expect(overview.container.querySelectorAll(".pt-btn--main")).toHaveLength(0);
    overview.unmount();
    draw(managerData(), "service");
    expect(screen.getAllByRole("button").filter((b) => b.classList.contains("pt-btn--main")).map((b) => b.textContent)).toEqual(["Log a service"]);
  });
});

describe("the sections", () => {
  it("Overview: the renewals, each with its state, date and door, and the service and last fill beside them", () => {
    draw(managerData());
    const renewals = within(screen.getByRole("region", { name: "Renewals" }));
    expect(renewals.getByText("Rego")).toBeInTheDocument();
    expect(renewals.getAllByText("Due in 25 days")).toHaveLength(2); // rego and green slip
    expect(renewals.getAllByText("to 12 Nov 2026")).toHaveLength(2);
    expect(renewals.getByText("to 7 Mar 2027")).toBeInTheDocument();
    for (const name of ["Renew rego", "Renew green slip", "Renew insurance"]) {
      const b = renewals.getByRole("button", { name });
      expect(b).toHaveTextContent(/^Renew$/);
      expect(b).toHaveClass("pt-btn--second");
    }
    const service = within(screen.getByRole("region", { name: "Service" }));
    expect(service.getByText("128,400 km, read day 2")).toBeInTheDocument();
    expect(service.getByText("At 130,200 km or by 30 Dec 2026, 1,800 km to go")).toBeInTheDocument();
    expect(service.getByText("day 110")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Last fuel" })).getByText("68.2 litres, $141.20, Ampol Botany")).toBeInTheDocument();
  });

  it("Overview: says the odometer once, and has no Value, Driver or Status row, no Details and no Where it stands", () => {
    draw(managerData());
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getAllByText(/128,400/)).toHaveLength(1);
    expect(screen.getAllByText(/128,400/)).toHaveLength(1); // not in the head's line either
    for (const gone of ["Value", "Driver", "Towed by", "Status", "Details", "Latest", "Make and model", "Plate"]) expect(within(panel).queryByText(gone)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Where it stands" })).toBeNull();
    expect(screen.queryByText(/Book value|Tiff puts it/)).toBeNull();
    expect(screen.queryByText("MR0HA3CD300812345")).toBeNull();
    expect(screen.queryByRole("button", { name: "Change driver" })).toBeNull();
  });

  it("Overview: says Not on file and offers Add for a renewal nobody entered", async () => {
    draw({ ...managerData(), vehicle: { ...hilux, ctpDays: null } } as VehiclePageData);
    const renewals = within(screen.getByRole("region", { name: "Renewals" }));
    expect(renewals.getByText("Not on file")).toBeInTheDocument();
    await user().click(renewals.getByRole("button", { name: "Add green slip" }));
    expect(screen.getByText("Screen ctp, alone")).toBeInTheDocument();
  });

  it("Overview: says an overdue rego in red where the rego is", () => {
    draw({ ...managerData(), vehicle: { ...hilux, regoDays: -3 } } as VehiclePageData);
    const word = within(screen.getByRole("region", { name: "Renewals" })).getByText("3 days overdue");
    expect(word.closest(".pt-state")).toHaveClass("pt-state--wrong");
  });

  it("Service: the history with its paper, the next one due and the year's spend", async () => {
    draw(managerData(), "service");
    expect(tab(/^Service/)).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "At 130,200 km or by 30 Dec 2026" })).toBeInTheDocument();
    const rows = within(screen.getByRole("table", { name: "Services" })).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Logbook service, 120,000 km")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Record kept")).toBeInTheDocument();
    expect(within(rows[1]).getByRole("button", { name: "Attach record" })).toBeInTheDocument();
    expect(screen.getByText("$898.00 on service in the last 12 months.")).toBeInTheDocument();
    await user().click(within(rows[1]).getByRole("button", { name: "Attach record" }));
    expect(screen.getByText("Screen log:s0, alone")).toBeInTheDocument();
  });

  it("Service: the kilometres, the line and the readings newest first, folded in from their old tab", async () => {
    draw(managerData(), "service");
    expect(screen.getByRole("img", { name: /The odometer over the last 12 months/ })).toBeInTheDocument();
    const rows = within(screen.getByRole("table", { name: "Readings" })).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[1].textContent)).toEqual(["128,400 km", "128,210 km", "127,100 km", "120,200 km", "110,150 km"]);
    expect(within(rows[0]).getByText("Fuel docket, Ampol Botany")).toBeInTheDocument();
    expect(within(rows[0]).getByText("+190")).toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: "Add a reading" }));
    expect(screen.getByText("Screen add:odo, alone")).toBeInTheDocument();
  });

  it("Fuel: the fills", () => {
    draw(managerData(), "fuel");
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText("Ampol Botany")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Company card")).toBeInTheDocument();
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

  it("Money: today's financials screen's content, the value, and its door for the edits", async () => {
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
    await u.click(screen.getByRole("button", { name: /^Add$/ }));
    for (const n of names) await u.click(screen.getByRole("menuitem", { name: new RegExp(`^${n}`) }));
  };

  it("offers Fuel, Kilometres, Service, Issue and Document, in that order", async () => {
    draw(managerData());
    await user().click(screen.getByRole("button", { name: /^Add$/ }));
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Fuel", "Kilometres", "Service", "Issue", "Document"]);
  });

  it("logs fuel through today's fuel screen, the one My vehicle's Log fuel records", async () => {
    draw(managerData());
    await pick("Fuel");
    expect(screen.getByText("Screen add:fuel, alone")).toBeInTheDocument();
  });

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

  it("pauses a reading and a fill on a vehicle off the road, as the server does", async () => {
    draw({ ...managerData(), vehicle: { ...hilux, status: "offroad" } } as VehiclePageData);
    await user().click(screen.getByRole("button", { name: /^Add$/ }));
    expect(screen.getByRole("menuitem", { name: /^Kilometres/ })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("menuitem", { name: /^Fuel/ })).toHaveAttribute("aria-disabled", "true");
  });

  it("offers no fuel and no reading for something with no motor", async () => {
    draw({ ...managerData(), vehicle: { ...hilux, motorised: false } } as VehiclePageData);
    await user().click(screen.getByRole("button", { name: /^Add$/ }));
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Service", "Issue", "Document"]);
  });

  it("Renew and Edit schedule open today's renewal screen and form", async () => {
    draw(managerData());
    await user().click(screen.getByRole("button", { name: "Renew green slip" }));
    expect(screen.getByText("Screen ctp, alone")).toBeInTheDocument();
    await user().click(within(opened()!).getByRole("button", { name: "Back" }));
    await user().click(tab(/^Service/));
    await user().click(screen.getByRole("button", { name: "Edit schedule" }));
    expect(screen.getByText("The vehicle form, filled in for Hilux")).toBeInTheDocument();
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
  it("offers Change driver first, then the status and the photo, and Remove vehicle last, in red", async () => {
    draw(managerData());
    await user().click(screen.getByRole("button", { name: /^Actions/ }));
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Change driver", "Change status", "Change photo", "Remove vehicle"]);
    expect(items[3]).toHaveClass("pt-menu-item--danger");
  });

  it("changes the driver through today's assignment, the pool included", async () => {
    draw(managerData());
    const u = user();
    await u.click(screen.getByRole("button", { name: /^Actions/ }));
    await u.click(screen.getByRole("menuitem", { name: "Change driver" }));
    expect(screen.getByRole("option", { name: "Lyle Irving" })).toHaveAttribute("aria-selected", "true");
    await u.click(screen.getByRole("option", { name: "Dan Walsh" }));
    expect(fleet.assignVehicle).toHaveBeenCalledWith("v1", "s-dan");
    await u.click(screen.getByRole("button", { name: /^Actions/ }));
    await u.click(screen.getByRole("menuitem", { name: "Change driver" }));
    await u.click(screen.getByRole("option", { name: "Pool, no driver" }));
    expect(fleet.assignVehicle).toHaveBeenLastCalledWith("v1", null);
  });

  it("changes the status through today's save", async () => {
    draw(managerData());
    const u = user();
    await u.click(screen.getByRole("button", { name: /^Actions/ }));
    await u.click(screen.getByRole("menuitem", { name: "Change status" }));
    await u.click(screen.getByRole("option", { name: "Off road" }));
    expect(fleet.saveVehicle).toHaveBeenCalledWith(expect.objectContaining({ id: "v1", status: "offroad" }));
  });

  it("asks before it removes", async () => {
    draw(managerData());
    const u = user();
    await u.click(screen.getByRole("button", { name: /^Actions/ }));
    await u.click(screen.getByRole("menuitem", { name: "Remove vehicle" }));
    expect(removeVehicle).not.toHaveBeenCalled();
    const ask = screen.getByRole("dialog", { name: "Remove Toyota Hilux SR5 XQG41B?" });
    await u.click(within(ask).getByRole("button", { name: "Remove vehicle" }));
    expect(removeVehicle).toHaveBeenCalledWith("v1");
    expect(replace).toHaveBeenCalledWith("/dashboard/team?view=vehicles");
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
});

describe("the money gate", () => {
  it("shows Money and Documents to the register, and the value only on Money", () => {
    draw(managerData());
    expect(tab(/^Money/)).toBeInTheDocument();
    expect(tab(/^Documents/)).toBeInTheDocument();
    expect(screen.queryByText("$41,000")).toBeNull();
    expect(screen.queryByText("$39,500")).toBeNull();
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
  it("has no Actions, no renewing and no assigning, and says they drive it", () => {
    draw(driverData());
    expect(screen.queryByRole("button", { name: /^Actions/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^(Renew|Add) / })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change driver" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit schedule" })).toBeNull();
    expect(screen.getByText("2021, Hilux, You drive it.")).toBeInTheDocument();
    /* the renewals still read, as My vehicle shows them */
    expect(within(screen.getByRole("region", { name: "Renewals" })).getAllByText("Due in 25 days")).toHaveLength(2);
  });

  it("shows the photo square without a door to change it", () => {
    draw(driverData());
    expect(screen.queryByRole("button", { name: /photo/i })).toBeNull();
    expect(screen.queryByText("Add a photo")).toBeNull();
  });

  it("adds fuel, a reading or an issue through My vehicle's own dialog, and no service", async () => {
    draw(driverData());
    const u = user();
    await u.click(screen.getByRole("button", { name: /^Add$/ }));
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Fuel", "Kilometres", "Issue"]);
    await u.click(screen.getByRole("menuitem", { name: "Kilometres" }));
    expect(screen.getByText("Today's log dialog: odo on v1")).toBeInTheDocument();
  });

  it("logs fuel from Add through My vehicle's Log fuel dialog", async () => {
    draw(driverData());
    const u = user();
    await u.click(screen.getByRole("button", { name: /^Add$/ }));
    await u.click(screen.getByRole("menuitem", { name: "Fuel" }));
    expect(screen.getByText("Today's log dialog: fuel on v1")).toBeInTheDocument();
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
